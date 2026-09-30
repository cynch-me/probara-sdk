/**
 * How a new results file appears: never empty or partial under a results name, whatever happens
 * while it is written. The file system calls of the writer are hooked to stop it (or fail it) at
 * the moment under test.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createReporter } from './reporter.js';
import { writeResultsFile, type ResultsFileHeader } from './results-file.js';
import type { TestResultInput } from './result.js';

/** Runs before each hooked call, with its path(s); a rejection fails the call. */
type Hook = (...paths: string[]) => Promise<void> | void;

const hooks = vi.hoisted(() => ({
  writeFile: undefined as Hook | undefined,
  link: undefined as Hook | undefined,
  rename: undefined as Hook | undefined,
  lstat: undefined as Hook | undefined,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      const [file] = args;
      // The writer passes paths; a file handle has none.
      await hooks.writeFile?.(typeof file === 'string' ? file : '');
      return actual.writeFile(...args);
    },
    link: async (...args: Parameters<typeof actual.link>) => {
      await hooks.link?.(String(args[0]), String(args[1]));
      return actual.link(...args);
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      await hooks.rename?.(String(args[0]), String(args[1]));
      return actual.rename(...args);
    },
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      await hooks.lstat?.(String(args[0]));
      return actual.lstat(...args);
    },
  };
});

const HEADER: ResultsFileHeader = { version: 1, project: 'SHOP' };
/** What `probara import results 'probara-results*.json'` matches. */
const RESULTS_NAME = /^probara-results.*\.json$/;

let dir: string;
let folders = 0;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'probara-results-publish-'));
});

afterEach(() => {
  hooks.writeFile = undefined;
  hooks.link = undefined;
  hooks.rename = undefined;
  hooks.lstat = undefined;
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A path in a new folder. */
function freshPath(): string {
  folders += 1;
  return join(dir, `run-${folders}`, 'probara-results.json');
}

function result(title: string, body?: string): TestResultInput {
  return {
    identity: { file: 'e2e/cart.spec.ts', titlePath: ['Cart', title] },
    status: 'failed',
    ...(body === undefined ? {} : { attachments: [{ name: 'log.txt', body }] }),
  };
}

/** A hook that holds the call until `release()`; `reached` settles once it is called. */
function gate() {
  let release!: () => void;
  let reach!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const reached = new Promise<void>((resolve) => (reach = resolve));
  const hold = async () => {
    reach();
    await released;
  };
  return { hold, reached, release };
}

function isBody(path: string): boolean {
  return basename(dirname(path)).endsWith('-attachments');
}

describe('publishing a new results file', () => {
  it('shows no file under a results name until the whole file is written, even to a writer that stops', async () => {
    const path = freshPath();
    const folder = dirname(path);
    const atBody = gate();
    hooks.writeFile = (target) => (isBody(target) ? atBody.hold() : undefined);
    const atPublish = gate();
    hooks.link = () => atPublish.hold();

    const writing = writeResultsFile(path, HEADER, [result('a', 'hello')], []);
    // A writer stopped (killed) while writing its bodies leaves no results file.
    await atBody.reached;
    expect(await readdir(folder)).toEqual(['probara-results-attachments']);
    atBody.release();

    // Once the JSON is whole, it waits under a name the import's glob never matches.
    await atPublish.reached;
    const waiting = (await readdir(folder)).filter(
      (name) => name !== 'probara-results-attachments',
    );
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatch(/^\./);
    expect(waiting.filter((name) => RESULTS_NAME.test(name))).toEqual([]);
    atPublish.release();

    expect(await writing).toBe(path);
    expect((await readdir(folder)).sort()).toEqual([
      'probara-results-attachments',
      'probara-results.json',
    ]);
    const written = JSON.parse(await readFile(path, 'utf8')) as { results: TestResultInput[] };
    expect(written.results).toHaveLength(1);
  });

  it('takes the next number when a file appears under the name while it writes, never overwriting it', async () => {
    const path = freshPath();
    const folder = dirname(path);
    // Another program (an older reporter, say) writes the same name meanwhile.
    hooks.writeFile = async (target) => {
      if (!isBody(target)) return;
      hooks.writeFile = undefined;
      await writeFile(path, '{"mine":true}', { flag: 'wx' });
    };

    const written = await writeResultsFile(path, HEADER, [result('a', 'later')], []);

    const sibling = join(folder, 'probara-results-2.json');
    expect(written).toBe(sibling);
    expect(await readFile(path, 'utf8')).toBe('{"mine":true}');
    // The bodies it wrote for the first name went with it; the file names those of its own.
    expect((await readdir(folder)).sort()).toEqual([
      'probara-results-2-attachments',
      'probara-results-2.json',
      'probara-results.json',
    ]);
    const file = JSON.parse(await readFile(sibling, 'utf8')) as { results: TestResultInput[] };
    const [body] = file.results[0]?.attachments as { path: string }[];
    expect(body?.path).toBe('probara-results-2-attachments/1-log.txt');
    expect(await readFile(join(folder, body?.path ?? ''), 'utf8')).toBe('later');
  });

  describe('where the file system has no hard links', () => {
    const noHardLinks = () => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    };

    it('takes the next number when a file appears under the name while it writes, never overwriting it', async () => {
      const path = freshPath();
      const folder = dirname(path);
      // Another program writes the same name just before this writer publishes.
      hooks.link = async (_temporary, target) => {
        if (target === path) await writeFile(path, '{"mine":true}', { flag: 'wx' });
        noHardLinks();
      };

      expect(await writeResultsFile(path, HEADER, [result('a')], [])).toBe(
        join(folder, 'probara-results-2.json'),
      );

      expect(await readFile(path, 'utf8')).toBe('{"mine":true}');
      expect((await readdir(folder)).sort()).toEqual([
        'probara-results-2.json',
        'probara-results.json',
      ]);
      const file = JSON.parse(await readFile(join(folder, 'probara-results-2.json'), 'utf8')) as {
        results: TestResultInput[];
      };
      expect(file.results.map((entry) => entry.identity.titlePath.at(-1))).toEqual(['a']);
    });

    it('shows no file under a results name until the whole file is there', async () => {
      const path = freshPath();
      const folder = dirname(path);
      hooks.link = noHardLinks;
      const atPublish = gate();
      let reached = false;
      hooks.rename = () => {
        reached = true;
        return atPublish.hold();
      };

      const writing = writeResultsFile(path, HEADER, [result('a'), result('b')], []);
      await Promise.race([atPublish.reached, writing]);

      // The file waits whole under a dot name, and nothing is under a results name yet.
      expect(reached).toBe(true);
      const waiting = (await readdir(folder)).filter(
        (name) => name !== 'probara-results-attachments',
      );
      expect(waiting.filter((name) => RESULTS_NAME.test(name))).toEqual([]);
      expect(waiting).toHaveLength(1);
      expect(waiting[0]).toMatch(/^\./);
      const whole = JSON.parse(await readFile(join(folder, waiting[0] ?? ''), 'utf8')) as {
        results: TestResultInput[];
      };
      expect(whole.results).toHaveLength(2);
      atPublish.release();

      expect(await writing).toBe(path);
      expect(await readdir(folder)).toEqual(['probara-results.json']);
      const file = JSON.parse(await readFile(path, 'utf8')) as { results: TestResultInput[] };
      expect(file.results).toHaveLength(2);
    });

    it('leaves no file under a results name when the writer stops before the file is in place', async () => {
      const path = freshPath();
      const folder = dirname(path);
      hooks.link = noHardLinks;
      hooks.rename = () => {
        throw Object.assign(new Error('input/output error'), { code: 'EIO' });
      };

      await expect(writeResultsFile(path, HEADER, [result('a', 'body')], [])).rejects.toThrow(
        'input/output error',
      );

      // No results file, no temporary file, no attachments folder: the next writer starts clean.
      expect(await readdir(folder)).toEqual([]);
    });

    it('leaves nothing behind when it cannot check whether the name is free', async () => {
      const path = freshPath();
      const folder = dirname(path);
      const calls: string[] = [];
      hooks.link = () => {
        calls.push('link');
        noHardLinks();
      };
      hooks.lstat = (target) => {
        if (target === path && calls.includes('link')) {
          calls.push('lstat');
          throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
        }
      };

      await expect(writeResultsFile(path, HEADER, [result('a', 'body')], [])).rejects.toThrow(
        'permission denied',
      );
      // The check that failed is the fallback's own, after the hard link was refused.
      expect(calls).toEqual(['link', 'lstat']);

      // Never published blind over a name it could not check, and nothing of its own is left.
      expect(await readdir(folder)).toEqual([]);
    });
  });

  it('leaves nothing of its own when writing fails, and the reporter says so in its summary', async () => {
    const path = freshPath();
    const folder = dirname(path);
    const earlier = await writeResultsFile(path, HEADER, [result('earlier', 'kept')], []);
    const before = await readFile(earlier, 'utf8');
    hooks.writeFile = (target) => {
      if (isBody(target)) throw Object.assign(new Error('no space left'), { code: 'ENOSPC' });
    };

    const reporter = createReporter({
      env: { PROBARA_ENABLED: 'false' },
      resultsFile: path,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });
    reporter.addResult(result('b', 'lost'));
    const summary = await reporter.complete();

    expect(summary.resultsFile).toEqual({
      path,
      results: 0,
      error: expect.stringContaining('no space left') as string,
    });
    // No sibling, no attachments folder of its own, no temporary file: only the earlier file.
    expect((await readdir(folder)).sort()).toEqual([
      'probara-results-attachments',
      'probara-results.json',
    ]);
    expect(await readFile(earlier, 'utf8')).toBe(before);
  });
});
