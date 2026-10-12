/**
 * `captureOutput` in real Vitest, against a fake Probara (V-D9): the stdout and stderr of each test and each attempt
 * attached as `stdout.log` and `stderr.log`, the hooks of a test included; the terminal output unchanged; nothing when
 * the option is off (its default) or when `silent` keeps Vitest from printing; and the output of a shard carried
 * through its blob and `--merge-reports`. Real Vitest in each supported major, no runner mocks.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildReporter } from './support/reporter-build.js';
import {
  createWorkspace,
  probaraEnv,
  TOKEN,
  VITEST_VERSIONS,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 240_000;

/**
 * A result of a results file, as far as this spec reads it. A body is stored under its `fileName` (the name the file
 * had), and a file under its `name`, with the `path` of its copy in the folder next to the results file.
 */
interface SavedResult {
  identity?: unknown;
  status: string;
  parameters?: Record<string, string>;
  attachments?: { name?: string; fileName?: string; path?: string }[];
}

/** The name an attachment of a results file holds: its file name, or the name it was given. */
function nameOf(attachment: { name?: string; fileName?: string }): string | undefined {
  return attachment.fileName ?? attachment.name;
}

/** The SHA-256 of `content`, in hex: what the fake records of the bytes it received. */
function sha256Of(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe.each(VITEST_VERSIONS)('$name: captureOutput', (vitest) => {
  let refused: FakeProbara;
  let merged: FakeProbara;
  let workspace: Workspace;
  let terminal: string;
  let silentTerminal: string;
  let filteredTerminal: string;

  /** The results of a results file the run wrote into the workspace. */
  function resultsOf(file: string): SavedResult[] {
    const saved = JSON.parse(readFileSync(join(workspace.dir, file), 'utf8')) as {
      results: SavedResult[];
    };
    return saved.results;
  }

  /** The results whose identity names `title` (the key holds the title path). */
  function resultsTitled(results: readonly SavedResult[], title: string): SavedResult[] {
    return results.filter((result) => JSON.stringify(result.identity ?? {}).includes(title));
  }

  /** The one result whose identity names `title`: the spec fails when there is none. */
  function resultOf(results: readonly SavedResult[], title: string): SavedResult {
    const [result] = resultsTitled(results, title);
    if (result === undefined) throw new Error(`no result is titled "${title}"`);
    return result;
  }

  /** The text of the attachment `name` of a result, read from the copy its results file names. */
  function textOf(result: SavedResult, name: string): string | undefined {
    const file = result.attachments?.find((attachment) => nameOf(attachment) === name);
    return file?.path === undefined
      ? undefined
      : readFileSync(join(workspace.dir, file.path), 'utf8');
  }

  beforeAll(async () => {
    await buildReporter();
    refused = await startFakeProbara({ token: TOKEN });
    // Probara refuses every report (a 400, which is not retried): the results go to a results file, which keeps the output.
    refused.fail('report', { status: 400 });
    merged = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest, 'output');
    const captured = await workspace.vitest(
      ['run'],
      probaraEnv(refused.baseUrl, { PROBARA_RESULTS_FILE: join(workspace.dir, 'captured.json') }),
    );
    terminal = captured.stdout + captured.stderr;
    await workspace.vitest(
      ['run', '--config', 'plain.config.mts'],
      probaraEnv(refused.baseUrl, { PROBARA_RESULTS_FILE: join(workspace.dir, 'plain.json') }),
    );
    const silent = await workspace.vitest(
      ['run', '--config', 'silent.config.mts'],
      probaraEnv(refused.baseUrl, { PROBARA_RESULTS_FILE: join(workspace.dir, 'silent.json') }),
    );
    silentTerminal = silent.stdout + silent.stderr;
    const filtered = await workspace.vitest(
      ['run', '--config', 'filtered.config.mts'],
      probaraEnv(refused.baseUrl, { PROBARA_RESULTS_FILE: join(workspace.dir, 'filtered.json') }),
    );
    filteredTerminal = filtered.stdout + filtered.stderr;
    // A shard sends nothing without a token, and keeps its blob, with the output of each attempt, for the merge.
    await workspace.vitest(['run', '--config', 'blob.config.mts', '--shard=1/1']);
    await workspace.vitest(['--merge-reports'], probaraEnv(merged.baseUrl));
  }, TIMEOUT);

  afterAll(async () => {
    await Promise.all([refused.close(), merged.close()]);
    await workspace.remove();
  });

  it('attaches what a test writes to stdout.log and stderr.log, each stream as written', () => {
    const result = resultOf(resultsOf('captured.json'), 'writes to stdout and to stderr');
    expect(textOf(result, 'stdout.log')).toBe('hello stdout\ninfo line\ndebug line\n');
    expect(textOf(result, 'stderr.log')).toBe('careful\nboom\n');
  });

  it('attaches the output of the hooks of a test to that test', () => {
    const result = resultOf(resultsOf('captured.json'), 'keeps the output of its hooks too');
    expect(textOf(result, 'stdout.log')).toBe('before each\nin the body\n');
    expect(textOf(result, 'stderr.log')).toBe('after each\n');
  });

  it('attaches the output of each attempt of a retried test to that attempt', () => {
    const attempts = resultsTitled(resultsOf('captured.json'), 'keeps the output of each attempt');
    const first = attempts.find((result) => result.parameters?.attempt === undefined);
    const second = attempts.find((result) => result.parameters?.attempt === '2');
    if (first === undefined || second === undefined) throw new Error('both attempts are reported');
    expect(first).toMatchObject({ status: 'failed' });
    expect(textOf(first, 'stdout.log')).toBe('attempt 1 writes\n');
    expect(second).toMatchObject({ status: 'passed' });
    expect(textOf(second, 'stdout.log')).toBe('attempt 2 writes\n');
  });

  it('attaches nothing to a test that wrote nothing, nor the output written while the file loads', () => {
    const results = resultsOf('captured.json');
    const [empty] = resultsTitled(results, 'writes nothing');
    expect(empty?.attachments ?? []).toEqual([]);
    for (const result of results) {
      for (const attachment of result.attachments ?? []) {
        expect(readFileSync(join(workspace.dir, attachment.path ?? ''), 'utf8')).not.toContain(
          'written while the file loads',
        );
      }
    }
  });

  it('leaves out the output of concurrent tests, which Vitest attributes to the wrong test, with a warning', () => {
    const results = resultsOf('captured.json');
    for (const title of [
      'writes while another one runs',
      'writes too',
      'a concurrent test on its own',
    ]) {
      const found = resultsTitled(results, title);
      expect(found).toHaveLength(1);
      expect(found[0]?.attachments ?? []).toEqual([]);
    }
    expect(terminal).toContain('left out');
  });

  it('keeps Vitest printing what the tests write', () => {
    expect(terminal).toContain('hello stdout');
    expect(terminal).toContain('boom');
  });

  it('attaches nothing when captureOutput is off, which is its default', () => {
    const names = resultsOf('plain.json').flatMap((result) =>
      (result.attachments ?? []).map(nameOf),
    );
    expect(names).not.toContain('stdout.log');
    expect(names).not.toContain('stderr.log');
  });

  it('keeps the output of a silent run in its report, though Vitest prints none of it', () => {
    expect(silentTerminal).not.toContain('hello stdout');
    const result = resultOf(resultsOf('silent.json'), 'writes to stdout and to stderr');
    expect(textOf(result, 'stdout.log')).toBe('hello stdout\ninfo line\ndebug line\n');
  });

  it('keeps the output that onConsoleLog keeps off the terminal in its report too', () => {
    expect(filteredTerminal).not.toContain('hello stdout');
    const result = resultOf(resultsOf('filtered.json'), 'writes to stdout and to stderr');
    expect(textOf(result, 'stderr.log')).toBe('careful\nboom\n');
  });

  it('carries the output of each attempt through a shard and --merge-reports', () => {
    const staged = merged.stagedFiles();
    expect(staged).toContainEqual(
      expect.objectContaining({
        name: 'stdout.log',
        sha256: sha256Of('hello stdout\ninfo line\ndebug line\n'),
      }),
    );
    expect(staged).toContainEqual(
      expect.objectContaining({ name: 'stdout.log', sha256: sha256Of('attempt 1 writes\n') }),
    );
    expect(staged).toContainEqual(
      expect.objectContaining({ name: 'stderr.log', sha256: sha256Of('careful\nboom\n') }),
    );
  });
});
