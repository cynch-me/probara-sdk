/**
 * `probara import results <file>`: a results file (written by a reporter or an import that could
 * not send, or with reporting off) sent again, against the fake Probara.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
): Promise<CliRun> {
  const run = await runCli(args, { env: configuredEnv(fake.baseUrl, env) });
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
  ): Promise<string> {
    const file = join(dir, 'offline.json');
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

  it('deletes the file it imports with --results-file pointing at it, once every result was sent', async () => {
    const file = join(dir, 'retry.json');
    fake.fail('report', FAIL, { times: 1 });
    const first = await cli([
      'import',
      'junit',
      'jest/junit.xml',
      '--max-retries',
      '0',
      '--results-file',
      file,
    ]);
    expect(first.exitCode).toBe(1);

    const retry = await cli(['import', 'results', file, '--results-file', file]);
    expect(retry.exitCode).toBe(0);
    expect(retry.stderr).toContain('[probara] Deleted the results file');
    await expect(readFile(file)).rejects.toThrow();
    // Sent once more, it is not there to be sent twice.
    const again = await cli(['import', 'results', file]);
    expect(again.exitCode).toBe(2);
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
    const file = await offlineFile(['--run-name', 'From the file', '--tag', 'offline']);
    await cli(['import', 'results', file], { PROBARA_RUN_NAME: 'From the environment' });
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

  it('prints one JSON document with --json', async () => {
    const file = await offlineFile();
    const run = await cli(['import', 'results', file, '--json']);

    expect(JSON.parse(run.stdout)).toMatchObject({
      status: 'completed',
      exitCode: 0,
      file: { path: file, results: 10 },
      tests: { passed: 7, failed: 2, skipped: 1, blocked: 0 },
      summary: { status: 'completed', recorded: 10 },
    });
  });

  it('exits 1 when the report fails, writing what was not sent to --results-file again', async () => {
    const file = await offlineFile();
    const again = join(dir, 'again.json');
    fake.fail('report', FAIL);
    const run = await cli([
      'import',
      'results',
      file,
      '--max-retries',
      '0',
      '--results-file',
      again,
    ]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      '[probara] Exit 1: reporting to Probara failed (the report failed)',
    );
    const written = JSON.parse(await readFile(again, 'utf8')) as { results: unknown[] };
    expect(written.results).toHaveLength(10);
  });

  it.each([
    [[], 'Missing the results file to import'],
    [['a.json', 'b.json'], 'Import one results file at a time'],
  ])('is a usage error (2) with %j', async (files, message) => {
    const run = await cli(['import', 'results', ...files]);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(message);
  });

  it.each([
    ['missing.json', undefined, 'missing.json could not be read (ENOENT)'],
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
    if (content !== undefined) await writeFile(file, content);
    const run = await cli(['import', 'results', file]);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(message);
    expect(fake.requests).toHaveLength(0);
  });
});
