/**
 * The reporter's reading of the channel, from lines as test processes append them: while they are
 * still being written, from several processes, malformed, and the cleanup after the run.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attemptKey, readSettings, writeSettings, type ChannelLine } from './channel.js';
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
    expect(readdirSync(channel.dir)).toEqual(['files', 'owner.json']);
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
        // Removed with the channel: a results file keeps a copy of its own.
        temporary: true,
      },
    ]);
  });

  it('tells the test files the setup file ran in, even once their attempts are taken', () => {
    appendFileSync(join(channel.dir, '101-0.jsonl'), text({ type: 'setup', file: FILE }));
    appendFileSync(
      join(channel.dir, '102-0.jsonl'),
      text({ ...REF, type: 'message', message: { type: 'comment', value: 'x' } }),
    );

    expect(channel.take(FILE).has(KEY)).toBe(true);
    expect(channel.hasSetup(FILE)).toBe(true);
    expect(channel.hasSetup('/work/app/tests/login.test.js')).toBe(false);
    appendFileSync(
      join(channel.dir, '102-0.jsonl'),
      text({ type: 'setup', file: '/work/app/tests/login.test.js' }),
    );
    expect(channel.hasSetup('/work/app/tests/login.test.js')).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('tells the tests the setup file skipped for runCasesOnly, by file, skipping malformed names', () => {
    const login = '/work/app/tests/login.test.js';
    appendFileSync(
      join(channel.dir, '101-0.jsonl'),
      text({
        type: 'selection',
        file: FILE,
        applied: true,
        deselected: [['cart', 'adds'], ['top level']],
      }),
    );
    appendFileSync(
      join(channel.dir, '102-0.jsonl'),
      `${JSON.stringify({ type: 'selection', file: FILE, applied: true, deselected: [[], [1, 'x'], ['cart', 'removes']] })}\n${JSON.stringify({ type: 'selection', file: login, applied: true })}\n`,
    );

    expect([...channel.deselected(FILE)].sort()).toEqual(
      [
        JSON.stringify([FILE, 'cart', 'adds']),
        JSON.stringify([FILE, 'cart', 'removes']),
        JSON.stringify([FILE, 'top level']),
      ].sort(),
    );
    expect(channel.deselected(login).size).toBe(0);
    expect([channel.selectionFailure(FILE), channel.selectionFailure(login)]).toEqual([
      undefined,
      undefined,
    ]);
    expect(warnings).toEqual([]);
  });

  it('tells why the setup file could not skip the tests of a file, an unknown reason as a failure', () => {
    const login = '/work/app/tests/login.test.js';
    const search = '/work/app/tests/search.test.js';
    appendFileSync(
      join(channel.dir, '101-0.jsonl'),
      [
        text({ type: 'selection', file: FILE, applied: false, reason: 'no-circus' }),
        // Written by another version of the setup file, or malformed.
        `${JSON.stringify({ type: 'selection', file: login, applied: false, reason: 'lost' })}\n`,
        `${JSON.stringify({ type: 'selection', file: search, applied: 'no' })}\n`,
      ].join(''),
    );

    expect(channel.selectionFailure(FILE)).toBe('no-circus');
    expect(channel.selectionFailure(login)).toBe('failed');
    expect(channel.selectionFailure(search)).toBeUndefined();
    expect(channel.deselected(FILE).size).toBe(0);
  });

  it("hands the setup file the reporter's settings, and none to a setup file without them", () => {
    expect(readSettings(channel.dir)).toEqual({ captureOutput: false });
    writeSettings(channel.dir, { captureOutput: true });
    expect(readSettings(channel.dir)).toEqual({ captureOutput: true });
    writeFileSync(join(channel.dir, 'settings.json'), '{"captureOutput":"yes"}');
    expect(readSettings(channel.dir)).toEqual({ captureOutput: false });
    writeFileSync(join(channel.dir, 'settings.json'), 'not json');
    expect(readSettings(channel.dir)).toEqual({ captureOutput: false });
    expect(readSettings('/no/such/channel')).toEqual({ captureOutput: false });
  });

  it('removes the directory when closed, the copies of attached files too', () => {
    appendFileSync(
      join(channel.dir, '101-0.jsonl'),
      text({ ...REF, type: 'message', message: { type: 'ignore' } }),
    );
    writeFileSync(join(channel.dir, 'files', 'copy'), 'bytes');
    channel.close();
    expect(existsSync(channel.dir)).toBe(false);
    expect(channel.take(FILE).size).toBe(0);
  });

  it("removes the channels of this user's runs that ended a day ago without removing them", () => {
    const parent = mkdtempSync(join(tmpdir(), 'probara-jest-parent-'));
    try {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600_000);
      const make = (name: string, old: boolean, file = false) => {
        const path = join(parent, name);
        if (file) writeFileSync(path, '');
        else mkdirSync(join(path, 'files'), { recursive: true });
        if (old && !file) utimesSync(join(path, 'files'), twoDaysAgo, twoDaysAgo);
        if (old) utimesSync(path, twoDaysAgo, twoDaysAgo);
      };
      make('probara-jest-channel-killed', true);
      make('probara-jest-channel-running', false);
      make('probara-jest-channel-a-file', true, true);
      make('another-tool-old', true);

      const fresh = createChannel(() => undefined, undefined, parent);
      fresh.close();

      expect(readdirSync(parent).sort()).toEqual([
        'another-tool-old',
        'probara-jest-channel-a-file',
        'probara-jest-channel-running',
      ]);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('keeps a channel a run still writes to, or whose reporter still runs, however old the folder', () => {
    const parent = mkdtempSync(join(tmpdir(), 'probara-jest-parent-'));
    try {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600_000);
      /** A channel whose folder and entries were last changed two days ago, but `fresh`. */
      const make = (name: string, fresh?: string, owner?: number) => {
        const path = join(parent, name);
        mkdirSync(join(path, 'files'), { recursive: true });
        writeFileSync(join(path, '101-0.jsonl'), '');
        if (owner !== undefined)
          writeFileSync(join(path, 'owner.json'), JSON.stringify({ pid: owner }));
        for (const entry of readdirSync(path)) {
          if (entry !== fresh) utimesSync(join(path, entry), twoDaysAgo, twoDaysAgo);
        }
        utimesSync(path, twoDaysAgo, twoDaysAgo);
      };
      // A helper appended a line today, or copied a file into files/.
      make('probara-jest-channel-lines', '101-0.jsonl');
      make('probara-jest-channel-files', 'files');
      // The reporter of a run that lasts days, idle for now.
      make('probara-jest-channel-alive', undefined, process.pid);
      make('probara-jest-channel-dead', undefined, 2 ** 22 + 7);

      const fresh = createChannel(() => undefined, undefined, parent);
      fresh.close();

      expect(readdirSync(parent).sort()).toEqual([
        'probara-jest-channel-alive',
        'probara-jest-channel-files',
        'probara-jest-channel-lines',
      ]);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('names its reporter in the channel, for the sweep of another run', () => {
    const owner = JSON.parse(readFileSync(join(channel.dir, 'owner.json'), 'utf8')) as unknown;
    expect(owner).toEqual({ pid: process.pid });
  });
});
