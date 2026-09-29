import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReportRequest } from '@probara/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixturePath } from './fixtures.js';
import { startFakeProbara, type FakeProbara } from './support/fake-probara.js';
import {
  configuredEnv,
  runCli,
  TOKEN,
  type CliRun,
  type RunCliOptions,
} from './support/run-cli.js';

let fake: FakeProbara;

beforeEach(async () => {
  fake = await startFakeProbara({ token: TOKEN });
});

afterEach(async () => {
  await fake.close();
});

/** Runs the CLI and checks the token never reaches any output. */
async function cli(args: readonly string[], options: RunCliOptions = {}): Promise<CliRun> {
  const run = await runCli(args, options);
  expect(run.stdout).not.toContain(TOKEN);
  expect(run.stderr).not.toContain(TOKEN);
  return run;
}

/** `probara import junit <args>` against the fake, configured by the environment. */
function importJunit(
  args: readonly string[],
  env: Record<string, string | undefined> = {},
): Promise<CliRun> {
  return cli(['import', 'junit', ...args], { env: configuredEnv(fake.baseUrl, env) });
}

/** How many stderr lines contain `text`. */
function linesWith(result: CliRun, text: string): number {
  return result.stderr.split('\n').filter((line) => line.includes(text)).length;
}

function entries(reports: readonly ReportRequest[] = fake.reports()) {
  return reports.flatMap((report) => report.results);
}

function keys(reports?: readonly ReportRequest[]): string[] {
  return entries(reports).map((entry) => entry.automationKey ?? '');
}

function onlyReport(): ReportRequest {
  const reports = fake.reports();
  expect(reports).toHaveLength(1);
  return reports[0] as ReportRequest;
}

describe('probara import junit: every dialect end to end', () => {
  it('imports a Jest report into a new, closed run', async () => {
    const run = await importJunit(['jest/junit.xml']);

    expect(run.exitCode).toBe(0);
    const report = onlyReport();
    expect(report.results).toHaveLength(10);
    expect(report.results[0]).toMatchObject({
      status: 'passed',
      caseDisplayId: 'PRB-12',
      automationKey: 'login logs in with a valid password',
      executedAt: '2026-09-29T18:47:29.000Z',
    });
    expect(report.results.map((entry) => entry.status)).toEqual([
      'passed',
      'failed',
      'failed',
      'skipped',
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
    ]);
    expect(report.options).toMatchObject({ createMissingCases: true, close: true });
    expect(fake.runs()).toHaveLength(1);
    expect(fake.runs()[0]?.state).toBe('closed');
    expect(run.stderr).toContain('[probara] Recorded 10 results');
  });

  it('imports a pytest report, linking the ids of properties and parameters', async () => {
    const run = await importJunit(['pytest/junit.xml']);

    expect(run.exitCode).toBe(0);
    const results = onlyReport().results;
    expect(results).toHaveLength(13);
    expect(results.filter((entry) => entry.caseDisplayId !== undefined)).toEqual([
      expect.objectContaining({
        caseDisplayId: 'PRB-13',
        automationKey: 'tests.test_login > test_records_a_probara_case_property',
      }),
      expect.objectContaining({
        caseDisplayId: 'PRB-14',
        automationKey: 'tests.test_login > test_unicode_parameter_ids[accepts caf\\xe9]',
      }),
    ]);
    expect(results.filter((entry) => entry.status === 'failed')).toHaveLength(3);
  });

  it('imports a Playwright report and uploads its attachments before closing the run', async () => {
    const run = await importJunit(['playwright/junit.xml']);

    expect(run.exitCode).toBe(0);
    const results = onlyReport().results;
    expect(results).toHaveLength(13);
    expect(results[0]).toMatchObject({
      caseDisplayId: 'PRB-12',
      automationKey: 'login.spec.js > login > logs in with a valid password [project=node]',
    });
    // The run stays open for the uploads, then closes on its own.
    expect(onlyReport().options?.close).toBe(false);
    expect(fake.stagedFiles()).toHaveLength(7);
    expect(fake.stagedFiles().map((file) => file.type)).toEqual(
      expect.arrayContaining(['image/png', 'text/plain', 'text/markdown']),
    );
    expect(fake.requestsTo('commit')).toHaveLength(4);
    expect(fake.requestsTo('closeRun')).toHaveLength(1);
    expect(fake.runs()[0]?.state).toBe('closed');
    expect(run.stderr).toContain('Attached 7 files to results (0 skipped, 0 failed)');
  });

  it('imports a folder of Surefire reports, one file per test class', async () => {
    const run = await importJunit(['surefire/surefire-reports']);

    expect(run.exitCode).toBe(0);
    expect(keys()).toEqual([
      // Files in name order: FlakyTest before LoginTest.
      'me.probara.fixture.FlakyTest > passesOnTheSecondAttempt',
      'me.probara.fixture.LoginTest > supportsSso',
      'me.probara.fixture.LoginTest > acceptsUnicode',
      'me.probara.fixture.LoginTest > crashesOnAnUnexpectedException',
      'me.probara.fixture.LoginTest > rejectsAWrongPassword',
      'me.probara.fixture.LoginTest > logsInWithAValidPassword',
      'me.probara.fixture.LoginTest > printsToStdoutAndStderr',
      'me.probara.fixture.LoginTest > recordsAProbaraCaseEntry(TestReporter)',
      'me.probara.fixture.LoginTest > usernameLength(String, int)[1]',
      'me.probara.fixture.LoginTest > usernameLength(String, int)[2]',
      'me.probara.fixture.LoginTest$Session$Refresh > renewsTheTokenBeforeExpiry',
    ]);
    expect(entries()[1]).toMatchObject({
      status: 'skipped',
      suitePath: ['me.probara.fixture.LoginTest'],
    });
  });

  it('imports a gotestsum report, keeping failed subtests and dropping their parents', async () => {
    const run = await importJunit(['gotestsum/junit.xml']);

    expect(run.exitCode).toBe(0);
    expect(keys()).toHaveLength(13);
    expect(keys()).toContain('example.com/probarafixture/auth > TestLogin > failing_subtest');
    expect(keys()).not.toContain('example.com/probarafixture/auth > TestLogin');
    expect(entries().find((entry) => entry.caseDisplayId === 'PRB-12')?.automationKey).toBe(
      'example.com/probarafixture/auth > TestLogin > logs_in_with_a_valid_password',
    );
  });

  it('gives the same key to the same test on every import', async () => {
    await importJunit(['playwright/junit.xml', '--no-attachments']);
    const second = await importJunit(['playwright/junit.xml', '--no-attachments']);

    const [first, again] = fake.reports();
    expect(keys([again as ReportRequest])).toEqual(keys([first as ReportRequest]));
    // Every key is known by now: the second import creates no case.
    expect(second.stderr).toContain('Recorded 13 results (0 new cases, 0 unmatched) in R-2');
  });
});

describe('probara import junit: files and globs', () => {
  it('sends every file and glob into one run: the first report creates it, later ones reuse it', async () => {
    const result = await importJunit([
      'surefire/surefire-reports/*.xml',
      'jest/junit.xml',
      '--chunk-size',
      '5',
    ]);

    expect(result.exitCode).toBe(0);
    const reports = fake.reports();
    expect(reports).toHaveLength(5);
    expect(reports[0]?.run).toMatchObject({ name: expect.any(String) as string });
    const created = fake.runs()[0]?.ulid;
    for (const report of reports.slice(1)) expect(report.run).toMatchObject({ ulid: created });
    expect(fake.runs()).toHaveLength(1);
    expect(entries()).toHaveLength(21);
    // Only the last report closes the run.
    expect(reports.map((report) => report.options?.close)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it('keeps the order of the patterns, sorts the paths of each, and reads a file once', async () => {
    const result = await cli(
      [
        'import',
        'junit',
        'jest/junit.xml',
        'surefire/surefire-reports/TEST-*.xml',
        'jest/junit.xml',
        '--dry-run',
        '--json',
      ],
      { env: {} },
    );

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as { files: { path: string; dialect: string }[] };
    expect(output.files.map((file) => file.path)).toEqual([
      'jest/junit.xml',
      'surefire/surefire-reports/TEST-me.probara.fixture.FlakyTest.xml',
      'surefire/surefire-reports/TEST-me.probara.fixture.LoginTest.xml',
    ]);
  });

  it('follows the order of the patterns, not the order of the file names', async () => {
    await importJunit(['jest/junit.xml', 'gotestsum/junit.xml']);
    await importJunit(['gotestsum/junit.xml', 'jest/junit.xml']);

    const [jestFirst, goFirst] = fake.reports();
    expect(jestFirst?.results[0]?.automationKey).toBe('login logs in with a valid password');
    expect(goFirst?.results[0]?.automationKey).toBe(
      'example.com/probarafixture/auth > TestRejectsAWrongPassword',
    );
  });

  it('accepts absolute paths and patterns', async () => {
    const result = await importJunit([fixturePath('gotestsum', '*.xml')]);

    expect(result.exitCode).toBe(0);
    // Sorted by name: junit-short-names.xml ("-") before junit.xml (".").
    expect(entries()).toHaveLength(26);
    expect(entries()[0]?.automationKey).toBe('auth > TestRejectsAWrongPassword');
  });

  it('warns about a pattern that matches nothing and imports the others', async () => {
    const result = await importJunit(['missing/*.xml', 'jest/junit.xml']);

    expect(result.exitCode).toBe(0);
    expect(linesWith(result, '[probara] No file matched missing/*.xml')).toBe(1);
    expect(result.stderr).not.toContain('No JUnit file matched');
    expect(entries()).toHaveLength(10);
  });

  it('is a usage error (2) when nothing matches at all, and sends nothing', async () => {
    const result = await importJunit(['missing/*.xml', 'nothing-here.xml']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('No JUnit file matched');
    expect(fake.requests).toHaveLength(0);
  });

  it('says once that nothing matched, without a warning per pattern repeating it', async () => {
    const single = await importJunit(['nothing/*.xml']);
    const several = await importJunit(['nothing/*.xml', 'nothing-here.xml']);

    expect(single.exitCode).toBe(2);
    expect(single.stderr).not.toContain('No file matched');
    expect(linesWith(single, 'No JUnit file matched nothing/*.xml.')).toBe(1);
    expect(several.exitCode).toBe(2);
    expect(several.stderr).not.toContain('No file matched');
    expect(linesWith(several, 'No JUnit file matched nothing/*.xml, nothing-here.xml.')).toBe(1);
  });

  it('is a usage error (2) without any path', async () => {
    const result = await importJunit([]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('probara import junit --help');
    expect(fake.requests).toHaveLength(0);
  });

  describe('with an invalid file among valid ones', () => {
    let dir: string;

    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'probara-cli-'));
      await cp(fixturePath('jest', 'junit.xml'), join(dir, 'a-valid.xml'));
      await writeFile(join(dir, 'b-broken.xml'), '<testsuites><testsuite name="x">');
      await writeFile(join(dir, 'c-not-junit.xml'), '<project><modelVersion/></project>');
    });

    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('parses every file first, reports each bad one, exits 2 and sends nothing', async () => {
      const result = await cli(['import', 'junit', '.'], {
        env: configuredEnv(fake.baseUrl),
        cwd: dir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('b-broken.xml: not well-formed XML');
      expect(result.stderr).toContain('c-not-junit.xml: not a JUnit report');
      expect(result.stderr).toContain(
        '[probara] Nothing was sent: 2 files could not be imported. Fix them or leave them out.',
      );
      expect(fake.requests).toHaveLength(0);
    });

    it('asks to fix one bad file or leave it out', async () => {
      const result = await cli(['import', 'junit', 'a-valid.xml', 'b-broken.xml'], {
        env: configuredEnv(fake.baseUrl),
        cwd: dir,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(
        '[probara] Nothing was sent: 1 file could not be imported. Fix it or leave it out.',
      );
    });
  });

  it('warns and exits 0 when the files hold no testcase', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'probara-cli-'));
    try {
      await writeFile(join(dir, 'empty.xml'), '<testsuites><testsuite name="none"/></testsuites>');
      const result = await cli(['import', 'junit', 'empty.xml'], {
        env: configuredEnv(fake.baseUrl),
        cwd: dir,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('No testcase found');
      expect(fake.requests).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('probara import junit: flags, environment and precedence', () => {
  it('reports into the project of --project over PROBARA_PROJECT, and links its ids', async () => {
    await importJunit(['jest/junit.xml', '--project', 'PRB'], { PROBARA_PROJECT: 'OTHER' });

    expect(fake.requestsTo('report')[0]?.projectId).toBe('PRB');
    expect(entries()[0]?.caseDisplayId).toBe('PRB-12');
  });

  it('links only the ids of the configured project', async () => {
    await importJunit(['jest/junit.xml'], { PROBARA_PROJECT: 'OTHER' });

    expect(fake.requestsTo('report')[0]?.projectId).toBe('OTHER');
    expect(entries().filter((entry) => entry.caseDisplayId !== undefined)).toEqual([]);
    expect(entries()[0]?.automationKey).toBe('login PRB-12 logs in with a valid password');
  });

  it('names the run and tags it from flags over the environment', async () => {
    await importJunit(
      ['jest/junit.xml', '--run-name', 'Nightly', '--tag', 'smoke,api', '--tag', 'nightly'],
      { PROBARA_RUN_NAME: 'From env', PROBARA_RUN_TAGS: 'env-tag' },
    );

    expect(onlyReport().run).toMatchObject({ name: 'Nightly', tags: ['smoke', 'api', 'nightly'] });
  });

  it('names and tags the run from the environment without flags', async () => {
    await importJunit(['jest/junit.xml'], {
      PROBARA_RUN_NAME: 'From env',
      PROBARA_RUN_TAGS: 'env-tag,second',
    });

    expect(onlyReport().run).toMatchObject({ name: 'From env', tags: ['env-tag', 'second'] });
  });

  it('sends the CI source: flags over PROBARA_* over the detected CI', async () => {
    await importJunit(['jest/junit.xml', '--branch', 'feature/flag'], {
      GITHUB_ACTIONS: 'true',
      GITHUB_REF_NAME: 'main',
      GITHUB_SHA: 'a'.repeat(40),
      PROBARA_COMMIT: 'b'.repeat(40),
    });

    expect(onlyReport().run).toMatchObject({
      source: { branch: 'feature/flag', commit: 'b'.repeat(40) },
    });
  });

  it('sends no source with --no-source', async () => {
    await importJunit(['jest/junit.xml', '--no-source'], { PROBARA_BRANCH: 'main' });

    expect(onlyReport().run).not.toHaveProperty('source');
  });

  it('does not create missing cases with --no-create-missing-cases, over the environment', async () => {
    const result = await importJunit(['jest/junit.xml', '--no-create-missing-cases'], {
      PROBARA_CREATE_MISSING_CASES: 'true',
    });

    expect(onlyReport().options?.createMissingCases).toBe(false);
    // Unmatched results are the server's answer, not a reporting failure.
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('not recorded (case_not_found)');
  });

  it('turns case creation off from PROBARA_CREATE_MISSING_CASES and back on with the flag', async () => {
    await importJunit(['jest/junit.xml'], { PROBARA_CREATE_MISSING_CASES: 'false' });
    await importJunit(['jest/junit.xml', '--create-missing-cases'], {
      PROBARA_CREATE_MISSING_CASES: 'false',
    });

    expect(fake.reports().map((report) => report.options?.createMissingCases)).toEqual([
      false,
      true,
    ]);
  });

  it('leaves the run open with --no-close-run, over PROBARA_CLOSE_RUN', async () => {
    await importJunit(['jest/junit.xml', '--no-close-run'], { PROBARA_CLOSE_RUN: 'true' });

    expect(onlyReport().options?.close).toBe(false);
    expect(fake.runs()[0]?.state).toBe('open');
  });

  it('reports into an existing run with --run-ulid and leaves it open', async () => {
    const ulid = fake.seedRun();
    const result = await importJunit(['jest/junit.xml', '--run-ulid', ulid.toLowerCase()]);

    expect(result.exitCode).toBe(0);
    expect(onlyReport().run).toEqual({ ulid });
    expect(fake.run(ulid)?.state).toBe('open');
    expect(result.stderr).toContain(`Run: ${ulid}`);
  });

  it('reports into the suite of --suite-ulid', async () => {
    const suite = '01KS0000000000000000000009';
    await importJunit(['jest/junit.xml', '--suite-ulid', suite]);

    expect(onlyReport().options?.suiteUlid).toBe(suite);
  });

  it('sends no attachment with --no-attachments, over PROBARA_UPLOAD_ATTACHMENTS', async () => {
    const result = await importJunit(['playwright/junit.xml', '--no-attachments'], {
      PROBARA_UPLOAD_ATTACHMENTS: 'true',
    });

    expect(result.exitCode).toBe(0);
    expect(fake.requestsTo('stage')).toHaveLength(0);
    expect(onlyReport().options?.close).toBe(true);
  });

  it('adds each testcase output as text files with --attach-output', async () => {
    await importJunit(['pytest/junit-logging-all.xml', '--attach-output']);

    const names = fake.stagedFiles().map((file) => file.name);
    expect(names).toContain('system-out.txt');
    expect(names).toContain('system-err.txt');
  });

  it('reads the dialect from --dialect instead of detecting it', async () => {
    await importJunit(['playwright/junit.xml', '--dialect', 'generic', '--no-attachments']);

    expect(keys()[0]).toBe('login.spec.js > login › logs in with a valid password');
  });

  it('records an <error> as blocked with --error-status blocked', async () => {
    await importJunit(['pytest/junit.xml', '--error-status', 'blocked']);

    const setupError = entries().find(
      (entry) => entry.automationKey === 'tests.test_login > test_errors_in_fixture_setup',
    );
    expect(setupError?.status).toBe('blocked');
  });

  it('sends the CLI name and version in the User-Agent', async () => {
    await importJunit(['jest/junit.xml']);

    expect(fake.requests[0]?.headers['user-agent']).toMatch(
      /^probara-cli\/\d+\.\d+\.\d+\S* probara-core\//,
    );
  });

  it('logs a pre-flight block without the token', async () => {
    const result = await importJunit([
      'jest/junit.xml',
      'playwright/junit.xml',
      '--run-name',
      'CI',
    ]);

    expect(result.stderr).toContain('[probara] jest/junit.xml: jest, 10 results');
    expect(result.stderr).toContain('[probara] playwright/junit.xml: playwright, 13 results');
    expect(result.stderr).toContain(
      '[probara] Results: 23 (17 passed, 4 failed, 2 skipped, 0 blocked)',
    );
    expect(result.stderr).toContain('[probara] Project: PRB');
    expect(result.stderr).toContain('[probara] Run: new run "CI"');
    expect(result.stderr).toContain(`[probara] Base URL: ${fake.baseUrl}`);
    expect(result.stderr).toContain('[probara] Missing cases: created');
    expect(result.stderr).toContain('[probara] Attachments: on');
  });

  it('writes debug lines only with --debug or PROBARA_DEBUG', async () => {
    const quiet = await importJunit(['jest/junit.xml']);
    const flag = await importJunit(['jest/junit.xml', '--debug']);
    const env = await importJunit(['jest/junit.xml'], { PROBARA_DEBUG: 'true' });

    expect(quiet.stderr).not.toContain('Sending report');
    expect(flag.stderr).toContain('[probara] Sending report');
    expect(env.stderr).toContain('[probara] Sending report');
  });

  it('writes nothing on stdout without --json', async () => {
    const result = await importJunit(['jest/junit.xml']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });
});

describe('probara import junit: configuration errors', () => {
  it('has no --token flag: the token only comes from PROBARA_API_TOKEN', async () => {
    const separate = await importJunit(['jest/junit.xml', '--token', 'visible-secret']);
    const inline = await importJunit(['jest/junit.xml', '--token=visible-secret']);

    for (const result of [separate, inline]) {
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('PROBARA_API_TOKEN');
      expect(result.stderr).not.toContain('visible-secret');
    }
    expect(fake.requests).toHaveLength(0);
  });

  it('is an error (2) when not configured, naming what to set', async () => {
    const result = await cli(['import', 'junit', 'jest/junit.xml'], {
      env: { PROBARA_BASE_URL: fake.baseUrl },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('PROBARA_API_TOKEN');
    expect(result.stderr).toContain('PROBARA_PROJECT');
    expect(result.stderr).toContain('--project');
    expect(fake.requests).toHaveLength(0);
  });

  it('is an error (2) without a token, even with --project', async () => {
    const result = await cli(['import', 'junit', 'jest/junit.xml', '--project', 'PRB'], {
      env: { PROBARA_BASE_URL: fake.baseUrl },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('PROBARA_API_TOKEN is not set');
    expect(fake.requests).toHaveLength(0);
  });

  it('is an error (2) without a project', async () => {
    const result = await importJunit(['jest/junit.xml'], { PROBARA_PROJECT: undefined });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--project or set PROBARA_PROJECT');
    expect(fake.requests).toHaveLength(0);
  });

  it('is an error (2) on a blank project, from the flag or the variable, before any request', async () => {
    const flag = await importJunit(['jest/junit.xml', '--project', '   '], {
      PROBARA_PROJECT: undefined,
    });
    const variable = await importJunit(['jest/junit.xml'], { PROBARA_PROJECT: '  ' });
    const both = await importJunit(['jest/junit.xml', '--project', ' '], { PROBARA_PROJECT: ' ' });

    for (const result of [flag, variable, both]) {
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(
        '[probara] The project is not set: pass --project or set PROBARA_PROJECT',
      );
      expect(result.stderr).not.toContain('pass projectId');
    }
    expect(fake.requests).toHaveLength(0);
  });

  it('falls back to PROBARA_PROJECT under a blank --project, like core', async () => {
    const result = await importJunit(['jest/junit.xml', '--project', ' '], {
      PROBARA_PROJECT: 'PRB',
    });

    expect(result.exitCode).toBe(0);
    expect(fake.requestsTo('report')[0]).toMatchObject({ projectId: 'PRB' });
  });

  it('is an error (2) on a blank token, before any request', async () => {
    const result = await importJunit(['jest/junit.xml'], { PROBARA_API_TOKEN: '   ' });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('[probara] PROBARA_API_TOKEN is not set');
    expect(fake.requests).toHaveLength(0);
  });

  it('sends nothing and exits 0 when PROBARA_ENABLED=false, after checking the files', async () => {
    const off = await importJunit(['jest/junit.xml'], { PROBARA_ENABLED: 'false' });
    const broken = await importJunit(['jest/junit.xml', 'missing.xml'], {
      PROBARA_ENABLED: 'false',
    });

    expect(off.exitCode).toBe(0);
    expect(off.stderr).toContain('disabled by PROBARA_ENABLED');
    expect(off.stderr).toContain('nothing was sent');
    expect(broken.exitCode).toBe(0);
    expect(fake.requests).toHaveLength(0);
  });

  it('still checks the input when PROBARA_ENABLED=false: an invalid file or no match exits 2', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'probara-cli-'));
    try {
      await writeFile(join(dir, 'broken.xml'), '<testsuites><testsuite name="x">');
      const env = configuredEnv(fake.baseUrl, { PROBARA_ENABLED: 'false' });
      const broken = await cli(['import', 'junit', 'broken.xml'], { env, cwd: dir });
      const unmatched = await cli(['import', 'junit', 'missing/*.xml'], { env, cwd: dir });

      expect(broken.exitCode).toBe(2);
      expect(broken.stderr).toContain('broken.xml: not well-formed XML');
      expect(unmatched.exitCode).toBe(2);
      expect(unmatched.stderr).toContain('No JUnit file matched missing/*.xml');
      expect(fake.requests).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is an error (2) on a core configuration problem, before any request', async () => {
    const ulid = await importJunit(['jest/junit.xml', '--run-ulid', 'not-a-ulid']);
    const chunk = await importJunit(['jest/junit.xml', '--chunk-size', '501']);
    const url = await importJunit(['jest/junit.xml'], { PROBARA_BASE_URL: 'ftp://nope' });

    expect(ulid.exitCode).toBe(2);
    expect(ulid.stderr).toContain('run.ulid is not a ULID');
    expect(chunk.exitCode).toBe(2);
    expect(chunk.stderr).toContain('chunkSize must be an integer from 1 to 500');
    expect(url.exitCode).toBe(2);
    expect(url.stderr).toContain('PROBARA_BASE_URL must be an http(s) URL');
    expect(fake.requests).toHaveLength(0);
  });

  it('is a usage error (2) on an unknown option or an invalid value', async () => {
    const unknown = await importJunit(['jest/junit.xml', '--frobnicate']);
    const integer = await importJunit(['jest/junit.xml', '--timeout', 'soon']);
    const dialect = await importJunit(['jest/junit.xml', '--dialect', 'cobol']);
    const negated = await importJunit(['jest/junit.xml', '--no-json']);
    const missing = await importJunit(['jest/junit.xml', '--project']);

    expect(unknown.stderr).toContain("Unknown option '--frobnicate'");
    expect(integer.stderr).toContain('--timeout must be a whole number');
    expect(dialect.stderr).toContain('--dialect must be one of auto, jest, pytest');
    expect(negated.stderr).toContain("Unknown option '--no-json'");
    expect(missing.stderr).toContain('--project needs a value');
    for (const result of [unknown, integer, dialect, negated, missing]) {
      expect(result.exitCode).toBe(2);
    }
    expect(fake.requests).toHaveLength(0);
  });
});

describe('probara import junit: exit codes of reporting failures', () => {
  it('exits 1 when every attempt of the report fails', async () => {
    fake.fail('report', { status: 500 });
    const result = await importJunit(['jest/junit.xml', '--max-retries', '2']);

    expect(result.exitCode).toBe(1);
    expect(fake.requestsTo('report')).toHaveLength(3);
    expect(result.stderr).toContain('[probara] 10 results were not sent');
    expect(result.stderr).toMatch(/Exit 1: reporting to Probara failed/);
  });

  it('retries a transient failure after its Retry-After and succeeds', async () => {
    fake.fail('report', { status: 503, headers: { 'retry-after': '1' } }, { times: 1 });
    const result = await importJunit(['jest/junit.xml']);

    expect(result.exitCode).toBe(0);
    expect(fake.requestsTo('report')).toHaveLength(2);
  });

  it('exits 1 on a partial report: the second chunk failed', async () => {
    fake.fail('report', { status: 422 }, { from: 2 });
    const result = await importJunit(['jest/junit.xml', '--chunk-size', '2', '--json']);

    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout) as { status: string; exitCode: number };
    expect(output).toMatchObject({ status: 'partial', exitCode: 1 });
    expect(fake.requestsTo('report')).toHaveLength(2);
  });

  it('names the run left open on exit 1, and how to import into it instead of a new run', async () => {
    fake.fail('report', { status: 422 }, { from: 2 });
    const result = await importJunit(['jest/junit.xml', '--chunk-size', '2']);

    expect(result.exitCode).toBe(1);
    const [run] = fake.runs();
    expect(run?.state).toBe('open');
    const hint = `[probara] The run ${run?.displayId ?? ''} (${fake.baseUrl}/projects/PRB/runs/${run?.displayId ?? ''}) is still open: --run-ulid ${run?.ulid ?? ''} imports into it instead of a new run`;
    expect(result.stderr.split('\n').filter((line) => line.includes(hint))).toHaveLength(1);
  });

  it.each([
    ['--run-ulid', (ulid: string) => ({ args: ['--run-ulid', ulid], env: {} })],
    ['PROBARA_RUN_ULID', (ulid: string) => ({ args: [], env: { PROBARA_RUN_ULID: ulid } })],
  ])(
    'names the reused run left open on exit 1 without offering %s again',
    async (_source, given) => {
      const ulid = fake.seedRun();
      const { args, env } = given(ulid);
      fake.fail('report', { status: 422 }, { from: 2 });
      const result = await importJunit(['jest/junit.xml', '--chunk-size', '2', ...args], env);

      expect(result.exitCode).toBe(1);
      const run = fake.run(ulid);
      expect(run?.state).toBe('open');
      const hint = `[probara] The run ${run?.displayId ?? ''} (${fake.baseUrl}/projects/PRB/runs/${run?.displayId ?? ''}) is still open: running the same command again sends every result into it again`;
      expect(result.stderr.split('\n').filter((line) => line.includes(hint))).toHaveLength(1);
      expect(result.stderr).not.toContain('instead of a new run');
    },
  );

  it('warns once that a reused run keeps its own name, in an import, a dry run and on exit 2', async () => {
    const warning = 'Ignored name: a reused run (run.ulid) keeps its own';
    const lines = (result: CliRun) =>
      result.stderr.split('\n').filter((line) => line.includes(warning)).length;
    const ulid = fake.seedRun();
    const reused = ['jest/junit.xml', '--run-ulid', ulid, '--run-name', 'Nightly'];

    const real = await importJunit(reused);
    const dryRun = await importJunit([...reused, '--dry-run']);
    const invalid = await importJunit([...reused, '--base-url', 'ftp://probara.test']);

    expect(real.exitCode).toBe(0);
    expect(lines(real)).toBe(1);
    expect(dryRun.exitCode).toBe(0);
    expect(lines(dryRun)).toBe(1);
    expect(invalid.exitCode).toBe(2);
    expect(lines(invalid)).toBe(1);

    const unmatched = await importJunit(['missing.xml', ...reused.slice(1)]);
    expect(unmatched.exitCode).toBe(2);
    expect(lines(unmatched)).toBe(1);
  });

  it('warns once when reporting is off, with or without --debug, where core only logs at debug', async () => {
    const reused = ['jest/junit.xml', '--run-ulid', fake.seedRun(), '--run-name', 'Nightly'];
    const truncated = ['jest/junit.xml', '--run-name', 'n'.repeat(250)];
    const off = { PROBARA_ENABLED: 'false' };

    const ignored = await importJunit(reused, off);
    const debug = await importJunit([...reused, '--debug'], off);
    const long = await importJunit(truncated, off);

    expect(ignored.exitCode).toBe(0);
    expect(linesWith(ignored, 'Ignored name: a reused run (run.ulid) keeps its own')).toBe(1);
    expect(debug.exitCode).toBe(0);
    expect(linesWith(debug, 'Ignored name: a reused run (run.ulid) keeps its own')).toBe(1);
    expect(long.exitCode).toBe(0);
    expect(linesWith(long, 'Truncated the run name to 200 characters')).toBe(1);
    expect(fake.requests).toHaveLength(0);
  });

  it('warns once when the files hold no testcase, so nothing is sent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'probara-cli-'));
    try {
      await writeFile(join(dir, 'empty.xml'), '<testsuites><testsuite name="none"/></testsuites>');
      const empty = (extra: readonly string[]) =>
        cli(['import', 'junit', 'empty.xml', ...extra], {
          env: configuredEnv(fake.baseUrl),
          cwd: dir,
        });

      const reused = await empty(['--run-ulid', fake.seedRun(), '--run-name', 'Nightly']);
      const long = await empty(['--run-name', 'n'.repeat(250)]);

      expect(reused.exitCode).toBe(0);
      expect(linesWith(reused, 'Ignored name: a reused run (run.ulid) keeps its own')).toBe(1);
      expect(long.exitCode).toBe(0);
      expect(linesWith(long, 'Truncated the run name to 200 characters')).toBe(1);
      expect(fake.requests).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('gives no run hint on exit 1 when no run exists, or the run was closed', async () => {
    fake.fail('report', { status: 500 }, { times: 1 });
    const none = await importJunit(['jest/junit.xml', '--max-retries', '0']);
    expect(none.exitCode).toBe(1);
    expect(none.stderr).not.toContain('--run-ulid');

    fake.fail('commit', { status: 422 });
    const closed = await importJunit(['playwright/junit.xml']);
    expect(closed.exitCode).toBe(1);
    expect(fake.runs()[0]?.state).toBe('closed');
    expect(closed.stderr).not.toContain('--run-ulid');
  });

  it('exits 1 when an attachment commit fails', async () => {
    fake.fail('commit', { status: 422 }, { times: 1 });
    const result = await importJunit(['playwright/junit.xml']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Attached 5 files to results (0 skipped, 2 failed)');
    expect(result.stderr).toMatch(/Exit 1: .*attachment/);
  });

  it('exits 0 with failed tests, and 3 with --fail-on-failed-tests', async () => {
    const plain = await importJunit(['jest/junit.xml']);
    const strict = await importJunit(['jest/junit.xml', '--fail-on-failed-tests']);

    expect(plain.exitCode).toBe(0);
    expect(strict.exitCode).toBe(3);
    expect(strict.stderr).toContain('Exit 3: 2 results failed or blocked (--fail-on-failed-tests)');
  });

  it('exits 0 with --fail-on-failed-tests when every test passed or was skipped', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'probara-cli-'));
    try {
      await writeFile(
        join(dir, 'green.xml'),
        '<testsuites><testsuite name="s"><testcase classname="c" name="passes"/>' +
          '<testcase classname="c" name="skips"><skipped/></testcase></testsuite></testsuites>',
      );
      const result = await cli(['import', 'junit', 'green.xml', '--fail-on-failed-tests'], {
        env: configuredEnv(fake.baseUrl),
        cwd: dir,
      });
      expect(result.exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('lets a reporting failure (1) win over failed tests (3)', async () => {
    fake.fail('report', { status: 500 });
    const result = await importJunit([
      'jest/junit.xml',
      '--fail-on-failed-tests',
      '--max-retries',
      '0',
    ]);

    expect(result.exitCode).toBe(1);
  });
});

describe('probara import junit --json', () => {
  it('prints one document: status, exit code, files, tests and the core summary', async () => {
    const result = await importJunit(['jest/junit.xml', 'playwright/junit.xml', '--json']);

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(output).toEqual({
      status: 'completed',
      exitCode: 0,
      files: [
        { path: 'jest/junit.xml', dialect: 'jest', results: 10 },
        { path: 'playwright/junit.xml', dialect: 'playwright', results: 13 },
      ],
      tests: { passed: 17, failed: 4, skipped: 2, blocked: 0 },
      summary: expect.objectContaining({
        status: 'completed',
        recorded: 23,
        run: expect.objectContaining({ displayId: 'R-1', state: 'closed' }) as unknown,
        attachments: { uploaded: 7, skipped: 0, failed: 0 },
      }) as unknown,
    });
  });

  it('prints the disabled status when PROBARA_ENABLED=false', async () => {
    const result = await importJunit(['jest/junit.xml', '--json'], { PROBARA_ENABLED: 'false' });

    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'disabled',
      exitCode: 0,
      summary: { status: 'disabled' },
    });
  });
});

describe('probara import junit --dry-run', () => {
  it('prints what would be sent, without a token and without any request', async () => {
    const result = await cli(['import', 'junit', 'jest/junit.xml', '--dry-run'], {
      env: { PROBARA_PROJECT: 'PRB', PROBARA_BASE_URL: fake.baseUrl },
    });

    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(11);
    expect(lines[0]).toBe('passed\tPRB-12\tlogin logs in with a valid password');
    expect(lines[1]).toBe('failed\t-\tlogin rejects a wrong password');
    expect(lines[9]).toBe('passed\tPRB-13\ttop-level test outside any describe');
    expect(lines[10]).toBe(
      'Total: 10 results from 1 file (7 passed, 2 failed, 1 skipped, 0 blocked)',
    );
    expect(result.stderr).toContain('Dry run: nothing was sent');
    expect(fake.requests).toHaveLength(0);
  });

  it('builds keys relative to --root-dir, like a real import', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'probara-cli-'));
    try {
      await writeFile(
        join(dir, 'report.xml'),
        `<testsuites name="jest tests"><testsuite name="cart">` +
          `<testcase classname="cart adds" name="cart adds" file="${dir}/tests/cart.test.js"/>` +
          `</testsuite></testsuites>`,
      );
      const plain = await cli(['import', 'junit', 'report.xml', '--dry-run'], {
        env: {},
        cwd: dir,
      });
      const rooted = await cli(
        ['import', 'junit', 'report.xml', '--dry-run', '--root-dir', 'tests'],
        { env: {}, cwd: dir },
      );

      expect(plain.stdout.split('\n')[0]).toBe('passed\t-\ttests/cart.test.js > cart adds');
      expect(rooted.stdout.split('\n')[0]).toBe('passed\t-\tcart.test.js > cart adds');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('links no id without a project', async () => {
    const result = await cli(['import', 'junit', 'jest/junit.xml', '--dry-run'], { env: {} });

    // Neither a token nor a project: a dry run needs neither.
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Project: (none: ids in test names are not linked)');

    expect(result.stdout.split('\n')[0]).toBe(
      'passed\t-\tlogin PRB-12 logs in with a valid password',
    );
  });

  it('prints the entries as JSON with --json', async () => {
    const result = await cli(['import', 'junit', 'gotestsum/junit.xml', '--dry-run', '--json'], {
      env: { PROBARA_PROJECT: 'PRB' },
    });

    const output = JSON.parse(result.stdout) as { entries: unknown[] } & Record<string, unknown>;
    expect(output).toMatchObject({
      dryRun: true,
      files: [{ path: 'gotestsum/junit.xml', dialect: 'gotestsum', results: 13 }],
      tests: { passed: 8, failed: 3, skipped: 2, blocked: 0 },
    });
    expect(output.entries).toHaveLength(13);
    expect(output.entries[5]).toMatchObject({
      status: 'passed',
      caseDisplayId: 'PRB-12',
      automationKey: 'example.com/probarafixture/auth > TestLogin > logs_in_with_a_valid_password',
      title: 'logs_in_with_a_valid_password',
    });
  });

  describe('with a testcase whose name holds no title', () => {
    let dir: string;

    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'probara-cli-'));
      // A Playwright name of nothing but separators leaves no title segment.
      await writeFile(
        join(dir, 'report.xml'),
        `<testsuites><testsuite name="a.spec.ts">` +
          `<testcase classname="a.spec.ts" name="a › works"/>` +
          `<testcase classname="a.spec.ts" name=" › "/>` +
          `</testsuite></testsuites>`,
      );
    });

    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('skips it with a warning naming the file, in a real import and in a dry run alike', async () => {
      const warning =
        'report.xml: skipped a testcase without a title: its name " › " holds only separators (classname "a.spec.ts")';
      const dryRun = await cli(['import', 'junit', 'report.xml', '--dry-run'], {
        env: {},
        cwd: dir,
      });
      const json = await cli(['import', 'junit', 'report.xml', '--dry-run', '--json'], {
        env: {},
        cwd: dir,
      });
      const real = await cli(['import', 'junit', 'report.xml', '--json'], {
        env: configuredEnv(fake.baseUrl),
        cwd: dir,
      });

      expect(real.exitCode).toBe(0);
      expect(real.stderr).toContain(warning);
      expect(JSON.parse(real.stdout)).toMatchObject({
        exitCode: 0,
        files: [{ path: 'report.xml', results: 1 }],
        summary: { status: 'completed', recorded: 1, invalid: 0 },
      });
      expect(dryRun.exitCode).toBe(0);
      expect(dryRun.stderr).toContain(warning);
      expect(dryRun.stdout).toBe(
        'passed\t-\ta.spec.ts > a > works\nTotal: 1 result from 1 file (1 passed, 0 failed, 0 skipped, 0 blocked)\n',
      );
      expect(json.exitCode).toBe(0);
      expect(JSON.parse(json.stdout)).toMatchObject({ dryRun: true, exitCode: 0, invalid: 0 });
    });
  });

  it('still exits 2 on a configuration problem other than the token or project', async () => {
    const result = await cli(
      ['import', 'junit', 'jest/junit.xml', '--dry-run', '--milestone-id', 'nope'],
      { env: {} },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('run.milestoneId is not a ULID');
    expect(result.stdout).toBe('');
  });

  it('still exits 2 on an invalid file', async () => {
    const result = await cli(['import', 'junit', 'surefire', '--dry-run'], { env: {} });

    // The folder holds the Maven project too: its pom.xml is not a JUnit report.
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('pom.xml: not a JUnit report');
  });
});
