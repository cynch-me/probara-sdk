/**
 * The reporter's reading of the channel, from lines as test processes append them: while they are
 * still being written, from several processes, malformed, and the cleanup after the run.
 */
import { appendFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attemptKey, type ChannelLine } from './channel.js';
import { createChannel, type Channel, type ChannelWarning } from './channel-reader.js';

const FILE = '/work/app/tests/cart.test.js';
const REF = { file: FILE, test: 'cart pays by card', attempt: 1 };
const KEY = attemptKey(FILE, REF.test, 1);

let channel: Channel;
let warnings: ChannelWarning[];

beforeEach(() => {
  warnings = [];
  channel = createChannel((warning) => warnings.push(warning));
});

afterEach(() => {
  channel.close();
});

function text(line: ChannelLine): string {
  return `${JSON.stringify(line)}\n`;
}

describe('createChannel', () => {
  it('creates a private directory for the run', () => {
    expect(readdirSync(channel.dir)).toEqual(['files']);
  });

  it('reads a line only once it is complete, even cut inside a character', () => {
    const lines = join(channel.dir, '101-0.jsonl');
    const bytes = Buffer.from(
      text({ ...REF, type: 'message', message: { type: 'comment', value: 'Paid €5' } }),
    );
    const cut = bytes.indexOf(Buffer.from('€')) + 1;
    writeFileSync(lines, bytes.subarray(0, cut));
    expect(channel.take(FILE).size).toBe(0);

    appendFileSync(lines, bytes.subarray(cut));
    appendFileSync(
      join(channel.dir, '102-0.jsonl'),
      text({ ...REF, type: 'message', message: { type: 'tags', value: ['from-another-worker'] } }),
    );
    expect(channel.take(FILE).get(KEY)?.metadata).toMatchObject({
      comment: 'Paid €5',
      tags: ['from-another-worker'],
    });
  });

  it('reports malformed metadata as problems, and skips lines it cannot read', () => {
    const lines = join(channel.dir, '101-0.jsonl');
    appendFileSync(lines, 'not json\n{"type":"message"}\n[1]\n');
    appendFileSync(
      lines,
      text({ ...REF, type: 'message', message: { type: 'title', value: 5 } as never }),
    );
    appendFileSync(
      lines,
      text({
        type: 'warning',
        message: 'probara.tags() takes strings',
        file: FILE,
        test: REF.test,
      }),
    );

    expect(channel.take(FILE).get(KEY)?.problems).toEqual([
      'Ignored malformed probara metadata (type "title")',
    ]);
    expect(warnings).toEqual([
      { message: 'probara.tags() takes strings', file: FILE, test: REF.test },
    ]);
  });

  it('never reads a file outside the channel, whatever a line names', () => {
    const lines = join(channel.dir, '101-0.jsonl');
    appendFileSync(
      lines,
      text({ ...REF, type: 'attachment', name: 'secrets', copy: '../../etc/passwd' }),
    );
    appendFileSync(
      lines,
      text({
        ...REF,
        type: 'attachment',
        name: 'log',
        copy: '0f8fad5b-d9cb-469f-a165-70867728950e',
        body: 'text',
      }),
    );
    expect(channel.take(FILE).get(KEY)?.attachments).toEqual([
      {
        name: 'log',
        fileName: 'log',
        contentType: 'text/plain',
        path: join(channel.dir, 'files', '0f8fad5b-d9cb-469f-a165-70867728950e'),
      },
    ]);
  });

  it('removes the directory when closed, or only its lines when the files are still needed', () => {
    const kept = createChannel(() => undefined);
    appendFileSync(
      join(kept.dir, '101-0.jsonl'),
      text({ ...REF, type: 'message', message: { type: 'ignore' } }),
    );
    writeFileSync(join(kept.dir, 'files', 'copy'), 'bytes');
    kept.close({ keepFiles: true });
    expect(readdirSync(kept.dir)).toEqual(['files']);
    expect(kept.take(FILE).size).toBe(0);

    channel.close();
    expect(existsSync(channel.dir)).toBe(false);
    expect(channel.take(FILE).size).toBe(0);
  });
});
