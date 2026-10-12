import { CUT_MARKER, MAX_OUTPUT_BYTES } from '@probara/core';
import { describe, expect, it } from 'vitest';
import type { ConsoleEntry } from './attempts.js';
import { ConsoleKeeper, outputAttachmentsOf } from './console-output.js';

const entry = (type: ConsoleEntry['type'], content: string, time: number): ConsoleEntry => ({
  type,
  content,
  time,
});

describe('outputAttachmentsOf', () => {
  it('attaches each stream as stdout.log or stderr.log, in the order written, and none without text', () => {
    const attachments = outputAttachmentsOf([
      entry('stdout', 'one\n', 1),
      entry('stderr', 'warn\n', 2),
      entry('stdout', 'two\n', 3),
    ]);
    expect(attachments).toEqual([
      { name: 'stdout.log', body: Buffer.from('one\ntwo\n'), contentType: 'text/plain' },
      { name: 'stderr.log', body: Buffer.from('warn\n'), contentType: 'text/plain' },
    ]);
    expect(outputAttachmentsOf([entry('stdout', '', 1)])).toEqual([]);
  });

  it('cuts a stream at the attachment cap with core cut marker, and writes nothing after the cut', () => {
    const [attachment] = outputAttachmentsOf([
      entry('stdout', 'x'.repeat(MAX_OUTPUT_BYTES), 1),
      entry('stdout', 'after the cut\n', 2),
    ]);
    const text = Buffer.from(attachment?.body ?? '').toString('utf8');
    expect(text.endsWith(CUT_MARKER)).toBe(true);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect(text).not.toContain('after the cut');
  });
});

describe('ConsoleKeeper', () => {
  const chunk = `${'x'.repeat(1024 * 1024 - 1)}\n`;
  const sizeOf = (entries: readonly ConsoleEntry[]) =>
    entries.reduce((sum, { content }) => sum + Buffer.byteLength(content), 0);

  it('keeps what a test writes to one stream up to the attachment cap, ends it with the cut line, and keeps nothing after', () => {
    const keeper = new ConsoleKeeper();
    for (let time = 0; time < 40; time += 1) keeper.add(entry('stdout', chunk, time));
    expect(sizeOf(keeper.entries)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect(keeper.entries.at(-1)?.content.endsWith(CUT_MARKER)).toBe(true);
    const kept = keeper.entries.length;
    keeper.add(entry('stdout', chunk, 41));
    expect(keeper.entries).toHaveLength(kept);
    const [file] = outputAttachmentsOf(keeper.entries);
    expect(file?.name).toBe('stdout.log');
    expect(Buffer.byteLength(file?.body as Buffer)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect((file?.body as Buffer).toString('utf8').endsWith(CUT_MARKER)).toBe(true);
  });

  it('caps each stream on its own: stderr is kept while stdout is cut', () => {
    const keeper = new ConsoleKeeper();
    for (let time = 0; time < 40; time += 1) keeper.add(entry('stdout', chunk, time));
    keeper.add(entry('stderr', 'a warning\n', 100));
    expect(keeper.entries.at(-1)).toEqual(entry('stderr', 'a warning\n', 100));
    const names = outputAttachmentsOf(keeper.entries).map((file) => file.name);
    expect(names).toEqual(['stdout.log', 'stderr.log']);
  });

  it('keeps the logs of both streams in the order they were written', () => {
    const keeper = new ConsoleKeeper();
    keeper.add(entry('stdout', 'first\n', 1));
    keeper.add(entry('stderr', 'second\n', 2));
    keeper.add(entry('stdout', 'third\n', 3));
    expect(keeper.entries.map(({ content }) => content)).toEqual([
      'first\n',
      'second\n',
      'third\n',
    ]);
  });
});
