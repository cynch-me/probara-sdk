/**
 * `probara import results <file>`: a results file (written by a reporter or an import that could
 * not send, or with reporting off) sent again, against the fake Probara.
 */
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReportRequest } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configuredEnv, runCli, TOKEN, type CliRun } from './support/run-cli.js';

let fake: FakeProbara;
let dir: string;

beforeEach(async () => {
  fake = await startFakeProbara({ token: TOKEN });
  dir = await mkdtemp(join(tmpdir(), 'probara-import-results-'));
});

afterEach(async () => {
  await fake.close();
  await rm(dir, { recursive: true, force: true });
});

/** Runs the CLI against the fake, configured by the environment; the token never shows. */
async function cli(
  args: readonly string[],
  env: Record<string, string | undefined> = {},
  cwd?: string,
): Promise<CliRun> {
  const run = await runCli(args, {
    env: configuredEnv(fake.baseUrl, env),
    ...(cwd === undefined ? {} : { cwd }),
  });
  expect(run.stdout).not.toContain(TOKEN);
  expect(run.stderr).not.toContain(TOKEN);
  return run;
}

function keys(reports: readonly ReportRequest[]): string[] {
  return reports.flatMap((report) => report.results.map((entry) => entry.automationKey ?? ''));
}

const FAIL = { status: 503, body: { error: { code: 'internal_error', message: 'Down' } } };

describe('probara import junit --results-file', () => {
  it('writes the results it could not send, and says how to send them', async () => {
    const file = join(dir, 'results.json');
    fake.fail('report', FAIL);
    const run = await cli([
      'import',
      'junit',
      'jest/junit.xml',
      '--max-retries',
      '0',
      '--results-file',
      file,
      '--run-name',
      'Nightly',
    ]);

    expect(run.exitCode).toBe(1);
    const written = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    expect(written).toMatchObject({ version: 1, project: 'PRB', run: { name: 'Nightly' } });
    expect(written.results).toHaveLength(10);
    expect(run.stderr).toContain(
      `[probara] Wrote the 10 results that were not sent to ${file}: send them with probara import results ${file}`,
    );
  });

  it('writes every result, relative to the current directory, with PROBARA_ENABLED=false', async () => {
    const run = await runCli(['import', 'junit', 'jest/junit.xml', '--json'], {
      env: {
        PROBARA_ENABLED: 'false',
        PROBARA_PROJECT: 'PRB',
        PROBARA_RESULTS_FILE: join(dir, 'offline.json'),
      },
    });

    expect(run.exitCode).toBe(0);
    const written = JSON.parse(await readFile(join(dir, 'offline.json'), 'utf8')) as {
      results: unknown[];
    };
    expect(written.results).toHaveLength(10);
    expect(JSON.parse(run.stdout)).toMatchObject({
      summary: {
        status: 'disabled',
        resultsFile: { path: join(dir, 'offline.json'), results: 10 },
      },
    });
  });
});

describe('probara import results', () => {
  /** A results file of every result of `jest/junit.xml`, written with reporting off. */
  async function offlineFile(
    extra: readonly string[] = [],
    report = 'jest/junit.xml',
    name = 'offline.json',
  ): Promise<string> {
    const file = join(dir, name);
    const run = await runCli(['import', 'junit', report, '--results-file', file, ...extra], {
      env: { PROBARA_ENABLED: 'false', PROBARA_PROJECT: 'PRB' },
    });
    expect(run.exitCode).toBe(0);
    return file;
  }

  it('sends a file written with reporting off like the import would have, into a new closed run', async () => {
    const file = await offlineFile(['--run-name', 'Nightly']);
    const run = await cli(['import', 'results', file]);

    expect(run.exitCode).toBe(0);
    const [report] = fake.reports();
    expect(fake.reports()).toHaveLength(1);
    expect(report?.run).toMatchObject({ name: 'Nightly' });
    expect(report?.options?.close).toBe(true);
    expect(report?.results[0]).toMatchObject({ caseDisplayId: 'PRB-12', status: 'passed' });

    const direct = await startFakeProbara({ token: TOKEN });
    try {
      await runCli(['import', 'junit', 'jest/junit.xml'], { env: configuredEnv(direct.baseUrl) });
      expect(keys(fake.reports())).toEqual(keys(direct.reports()));
    } finally {
      await direct.close();
    }
    expect(run.stderr).toContain('offline.json: 10 results');
    expect(run.stderr).toContain(
      '[probara] Results: 10 (7 passed, 2 failed, 1 skipped, 0 blocked)',
    );
  });

  it('sends what a partial import could not into the run it left open, and closes it', async () => {
    const file = join(dir, 'partial.json');
    fake.fail('report', FAIL, { from: 2 });
    const first = await cli([
      'import',
      'junit',
      'jest/junit.xml',
      '--chunk-size',
      '4',
      '--max-retries',
      '0',
      '--results-file',
      file,
    ]);
    expect(first.exitCode).toBe(1);
    const [created] = fake.runs();

    const retry = await startFakeProbara({ token: TOKEN });
    try {
      const openRun = retry.seedRun({ projectId: 'PRB', ulid: created?.ulid ?? '' });
      const run = await runCli(['import', 'results', file], { env: configuredEnv(retry.baseUrl) });

      expect(run.exitCode).toBe(0);
      expect(retry.reports().map((report) => report.run)).toEqual([{ ulid: openRun }]);
      expect(retry.reports().flatMap((report) => report.results)).toHaveLength(6);
      expect(retry.run(openRun)?.state).toBe('closed');
    } finally {
      await retry.close();
    }
  });

  it('deletes the file and its attachments folder once every result was sent', async () => {
    const file = await offlineFile(['--attach-output'], 'pytest/junit-logging-all.xml');
    const folder = join(dir, 'offline-attachments');
    await access(folder);

    const run = await cli(['import', 'results', file]);

    expect(run.exitCode).toBe(0);
    await expect(access(file)).rejects.toThrow();
    await expect(access(folder)).rejects.toThrow();
    expect(run.stderr).toContain(`[probara] Deleted ${file} and ${folder}: every result was sent`);
    // Sent once more, it is not there to be sent twice: nothing matches, nothing is sent.
    const again = await cli(['import', 'results', file]);
    expect(again.exitCode).toBe(0);
    expect(fake.reports()).toHaveLength(1);
  });

  it('rewrites the file with only what was not sent after a partial send, so a re-run sends only that', async () => {
    const file = await offlineFile();
    fake.fail('report', FAIL, { from: 2 });
    const first = await cli(['import', 'results', file, '--chunk-size', '4', '--max-retries', '0']);
    expect(first.exitCode).toBe(1);
    const [created] = fake.runs();
    const left = JSON.parse(await readFile(file, 'utf8')) as {
      run: { ulid?: string };
      results: unknown[];
    };
    // The first report of 4 was recorded; the 6 others wait, for the run their report left open.
    expect(left.results).toHaveLength(6);
    expect(left.run.ulid).toBe(created?.ulid);
    expect(first.stderr).toContain(
      `[probara] Wrote the 6 results that were not sent to ${file}: send them with probara import results ${file}`,
    );

    const retry = await startFakeProbara({ token: TOKEN });
    try {
      const openRun = retry.seedRun({ projectId: 'PRB', ulid: created?.ulid ?? '' });
      const run = await runCli(['import', 'results', file], { env: configuredEnv(retry.baseUrl) });

      expect(run.exitCode).toBe(0);
      expect(retry.reports().map((report) => report.run)).toEqual([{ ulid: openRun }]);
      expect(retry.reports().flatMap((report) => report.results)).toHaveLength(6);
      await expect(access(file)).rejects.toThrow();
    } finally {
      await retry.close();
    }
  });

  it('leaves the file as it is with --dry-run and with reporting off, whatever PROBARA_RESULTS_FILE says', async () => {
    const file = await offlineFile(['--attach-output'], 'pytest/junit-logging-all.xml');
    const before = await readFile(file, 'utf8');

    const dryRun = await runCli(['import', 'results', file, '--dry-run'], {
      env: { PROBARA_RESULTS_FILE: file },
    });
    const off = await runCli(['import', 'results', file], {
      env: { PROBARA_ENABLED: 'false', PROBARA_PROJECT: 'PRB', PROBARA_RESULTS_FILE: file },
    });

    expect([dryRun.exitCode, off.exitCode]).toEqual([0, 0]);
    expect(await readFile(file, 'utf8')).toBe(before);
    await access(join(dir, 'offline-attachments'));
  });

  it('never adds the results it sends back to its own file through PROBARA_RESULTS_FILE', async () => {
    const file = await offlineFile();
    fake.fail('report', FAIL);
    const run = await cli(['import', 'results', file, '--max-retries', '0'], {
      PROBARA_RESULTS_FILE: file,
    });

    expect(run.exitCode).toBe(1);
    const left = JSON.parse(await readFile(file, 'utf8')) as { results: unknown[] };
    expect(left.results).toHaveLength(10);
  });

  it('takes no --results-file: what it cannot send goes back to its own file', async () => {
    const file = await offlineFile();
    const run = await cli(['import', 'results', file, '--results-file', join(dir, 'other.json')]);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('--results-file');
    expect(fake.requests).toHaveLength(0);
  });

  it('closes the runs the file says to close, and leaves the reused ones open unless told', async () => {
    const shopRun = fake.seedRun({ projectId: 'PRB' });
    const webRun = fake.seedRun({ projectId: 'WEB' });
    const file = join(dir, 'projects.json');
    const identity = (title: string) => ({ file: 'cart.spec.ts', titlePath: ['cart', title] });
    const contents = (close: Record<string, boolean>) =>
      JSON.stringify({
        version: 1,
        project: 'PRB',
        projects: ['WEB'],
        run: { ulid: shopRun, ulids: { WEB: webRun }, close },
        results: [
          { identity: identity('pays'), status: 'passed' },
          { identity: identity('lists'), status: 'passed', caseDisplayId: 'WEB-1' },
        ],
      });
    await writeFile(file, contents({ PRB: true, WEB: false }));

    const run = await cli(['import', 'results', file], { PROBARA_PROJECT: undefined });
    expect(run.exitCode).toBe(0);
    expect(fake.run(shopRun)?.state).toBe('closed');
    expect(fake.run(webRun)?.state).toBe('open');

    // The import consumed the file: write it again for the next one.
    await writeFile(file, contents({ PRB: true, WEB: false }));
    const again = await startFakeProbara({ token: TOKEN });
    try {
      again.seedRun({ projectId: 'PRB', ulid: shopRun });
      again.seedRun({ projectId: 'WEB', ulid: webRun });
      const flagged = await runCli(['import', 'results', file, '--close-run'], {
        env: configuredEnv(again.baseUrl, { PROBARA_PROJECT: undefined }),
      });
      expect(flagged.exitCode).toBe(0);
      expect([again.run(shopRun)?.state, again.run(webRun)?.state]).toEqual(['closed', 'closed']);
    } finally {
      await again.close();
    }
  });

  it('uploads the attachments of the file under their own names', async () => {
    const file = await offlineFile(['--attach-output'], 'pytest/junit-logging-all.xml');
    const run = await cli(['import', 'results', file]);

    expect(run.exitCode).toBe(0);
    const names = fake.stagedFiles().map((staged) => staged.name);
    expect(names).toContain('system-out.txt');
    expect(names).toContain('system-err.txt');
  });

  it('takes the flags over the variables over the settings of the file', async () => {
    const settings = ['--run-name', 'From the file', '--tag', 'offline'];
    const file = await offlineFile(settings);
    await cli(['import', 'results', file], { PROBARA_RUN_NAME: 'From the environment' });
    // The import consumed the file: write it again for the next one.
    await offlineFile(settings);
    await cli(['import', 'results', file, '--run-name', 'From the flag'], {
      PROBARA_RUN_NAME: 'From the environment',
    });

    expect(fake.reports().map((report) => report.run)).toEqual([
      expect.objectContaining({ name: 'From the environment', tags: ['offline'] }),
      expect.objectContaining({ name: 'From the flag', tags: ['offline'] }),
    ]);
  });

  it('prints what would be sent with --dry-run, without a token and without any request', async () => {
    const file = await offlineFile();
    const run = await runCli(['import', 'results', file, '--dry-run'], { env: {} });

    expect(run.exitCode).toBe(0);
    const lines = run.stdout.trimEnd().split('\n');
    expect(lines[0]).toBe('passed\tPRB-12\tlogin logs in with a valid password');
    expect(lines.at(-1)).toBe(
      'Total: 10 results from 1 file (7 passed, 2 failed, 1 skipped, 0 blocked)',
    );
    expect(run.stderr).toContain('[probara] Project: PRB');
    expect(fake.requests).toHaveLength(0);
  });

  it('prints one JSON document with --json, one entry per file', async () => {
    const file = await offlineFile();
    const run = await cli(['import', 'results', file, '--json']);

    expect(JSON.parse(run.stdout)).toEqual({
      exitCode: 0,
      files: [
        {
          path: file,
          results: 10,
          status: 'completed',
          tests: { passed: 7, failed: 2, skipped: 1, blocked: 0 },
          summary: expect.objectContaining({ status: 'completed', recorded: 10 }) as unknown,
        },
      ],
    });
  });

  it('exits 1 when the report fails, keeping every result in the file', async () => {
    const file = await offlineFile();
    fake.fail('report', FAIL);
    const run = await cli(['import', 'results', file, '--max-retries', '0']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      '[probara] Exit 1: reporting to Probara failed (the report failed)',
    );
    const written = JSON.parse(await readFile(file, 'utf8')) as { results: unknown[] };
    expect(written.results).toHaveLength(10);
  });

  it('is a usage error (2) without a file', async () => {
    const run = await cli(['import', 'results']);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('Missing the results files (or globs) to import');
  });

  it.each([
    ['text.json', 'not json', 'text.json is not JSON'],
    [
      'future.json',
      '{"version":2,"results":[]}',
      'future.json holds version 2 of the results file: this version reads version 1',
    ],
    [
      'settings.json',
      '{"version":1,"run":{"tags":"x"},"results":[]}',
      'run.tags must be a list of strings',
    ],
  ])('exits 2 on %s, sending nothing', async (name, content, message) => {
    const file = join(dir, name);
    await writeFile(file, content);
    const run = await cli(['import', 'results', file]);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(message);
    expect(fake.requests).toHaveLength(0);
  });

  describe('with several files and globs', () => {
    it('sends each file into its own runs, and consumes each on its own', async () => {
      await offlineFile(['--run-name', 'First'], 'jest/junit.xml', 'probara-results.json');
      await offlineFile(['--run-name', 'Second'], 'pytest/junit.xml', 'probara-results-2.json');

      const run = await cli(['import', 'results', 'probara-results*.json'], {}, dir);

      expect(run.exitCode).toBe(0);
      expect(fake.reports().map((report) => report.run)).toEqual([
        expect.objectContaining({ name: 'First' }),
        expect.objectContaining({ name: 'Second' }),
      ]);
      expect(fake.runs().map((created) => created.state)).toEqual(['closed', 'closed']);
      await expect(access(join(dir, 'probara-results.json'))).rejects.toThrow();
      await expect(access(join(dir, 'probara-results-2.json'))).rejects.toThrow();
      expect(run.stderr).toContain('[probara] probara-results.json: 10 results');
      expect(run.stderr).toContain('[probara] Deleted probara-results.json: every result was sent');
      expect(run.stderr).toContain(
        '[probara] Deleted probara-results-2.json: every result was sent',
      );
    });

    it('keeps what a file could not send in that file only, sends the others, and exits 1', async () => {
      await offlineFile([], 'jest/junit.xml', 'a.json');
      await offlineFile([], 'jest/junit.xml', 'b.json');
      const before = await readFile(join(dir, 'b.json'), 'utf8');
      // The report of a.json is the first; b.json's is refused.
      fake.fail('report', FAIL, { from: 2 });

      const run = await cli(
        ['import', 'results', 'a.json', 'b.json', '--max-retries', '0'],
        {},
        dir,
      );

      expect(run.exitCode).toBe(1);
      await expect(access(join(dir, 'a.json'))).rejects.toThrow();
      const left = JSON.parse(await readFile(join(dir, 'b.json'), 'utf8')) as {
        results: unknown[];
      };
      expect(left.results).toEqual((JSON.parse(before) as { results: unknown[] }).results);
      expect(run.stderr).toContain(
        '[probara] Exit 1: reporting to Probara failed (b.json: the report failed)',
      );
    });

    it('exits 0 with an info line when no file matches: nothing was left unsent', async () => {
      const run = await cli(['import', 'results', 'probara-results*.json', '--json'], {}, dir);

      expect(run.exitCode).toBe(0);
      expect(run.stderr).toContain(
        '[probara] No results file matched probara-results*.json: nothing was left unsent',
      );
      expect(JSON.parse(run.stdout)).toEqual({ exitCode: 0, files: [] });
      expect(fake.requests).toHaveLength(0);
    });

    it('still checks the flags and variables when no file matches', async () => {
      const run = await cli(['import', 'results', 'none*.json', '--chunk-size', '0'], {}, dir);

      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain('chunkSize');
    });

    it('warns about a pattern that matched nothing when another one did', async () => {
      await offlineFile([], 'jest/junit.xml', 'probara-results.json');
      const run = await cli(['import', 'results', 'probara-results.json', 'shard-*.json'], {}, dir);

      expect(run.exitCode).toBe(0);
      expect(run.stderr).toContain('[probara] No file matched shard-*.json');
    });

    it('sends nothing, and leaves every file, when one of them cannot be imported', async () => {
      const good = await offlineFile([], 'jest/junit.xml', 'probara-results.json');
      const before = await readFile(good, 'utf8');
      await writeFile(join(dir, 'probara-results-2.json'), '{"mine":true}');

      const run = await cli(['import', 'results', 'probara-results*.json'], {}, dir);

      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain(
        '[probara] probara-results-2.json is not a Probara results file',
      );
      expect(run.stderr).toContain(
        '[probara] Nothing was sent: 1 file could not be imported. Fix it or leave it out.',
      );
      expect(await readFile(good, 'utf8')).toBe(before);
      expect(fake.requests).toHaveLength(0);
    });

    it('refuses a directory: its JSON files are not all results files', async () => {
      const run = await cli(['import', 'results', '.'], {}, dir);

      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain(
        ". is a directory: give the results files, or a glob such as 'probara-results*.json'",
      );
    });

    it('prints what each file would send with --dry-run, and one total, leaving every file', async () => {
      const first = await offlineFile([], 'jest/junit.xml', 'probara-results.json');
      const second = await offlineFile([], 'jest/junit.xml', 'probara-results-2.json');
      const before = [await readFile(first, 'utf8'), await readFile(second, 'utf8')];

      const run = await runCli(['import', 'results', 'probara-results*.json', '--dry-run'], {
        env: {},
        cwd: dir,
      });

      expect(run.exitCode).toBe(0);
      const lines = run.stdout.trimEnd().split('\n');
      expect(lines).toHaveLength(21);
      expect(lines.at(-1)).toBe(
        'Total: 20 results from 2 files (14 passed, 4 failed, 2 skipped, 0 blocked)',
      );
      expect([await readFile(first, 'utf8'), await readFile(second, 'utf8')]).toEqual(before);
      expect(fake.requests).toHaveLength(0);
    });

    it('prints one JSON document of every file with --dry-run --json', async () => {
      await offlineFile([], 'jest/junit.xml', 'probara-results.json');
      await offlineFile([], 'jest/junit.xml', 'probara-results-2.json');

      const run = await runCli(
        ['import', 'results', 'probara-results*.json', '--dry-run', '--json'],
        { env: {}, cwd: dir },
      );

      const document = JSON.parse(run.stdout) as {
        dryRun: boolean;
        exitCode: number;
        files: { path: string; results: number; entries: unknown[] }[];
      };
      expect(document).toMatchObject({ dryRun: true, exitCode: 0 });
      expect(
        document.files.map(({ path, results, entries }) => [path, results, entries.length]),
      ).toEqual([
        ['probara-results.json', 10, 10],
        ['probara-results-2.json', 10, 10],
      ]);
    });
  });
});
