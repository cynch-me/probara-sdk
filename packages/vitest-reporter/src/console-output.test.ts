import { CUT_MARKER, MAX_OUTPUT_BYTES } from '@probara/core';
import { describe, expect, it } from 'vitest';
import type { ConsoleEntry } from './attempts.js';
import { outputAttachmentsOf } from './console-output.js';

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
