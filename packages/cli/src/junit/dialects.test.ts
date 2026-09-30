import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { buildAutomationKey, toReportEntry, type TestResultInput } from '@probara/core';
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR, fixturePath, fixtureXmlFiles } from '../../test/fixtures.js';
import { junitToResults, type JUnitToResultsOptions } from './to-results.js';

function convert(path: string, options: Partial<JUnitToResultsOptions> = {}) {
  return junitToResults(readFileSync(path, 'utf8'), {
    filePath: path,
    projectCodes: ['PRB'],
    ...options,
  });
}

function keyOf(result: TestResultInput): string {
  return buildAutomationKey(result.identity, { rootDir: FIXTURES_DIR });
}

function find(results: readonly TestResultInput[], key: string): TestResultInput {
  const matches = results.filter((result) => keyOf(result) === key);
  expect(matches, `one result with the key ${key}`).toHaveLength(1);
  return matches[0] as TestResultInput;
}

function entryOf(result: TestResultInput) {
  const { entry, warnings } = toReportEntry(result, { rootDir: FIXTURES_DIR });
  expect(warnings).toEqual([]);
  return entry;
}

function expectEverySendable(results: readonly TestResultInput[]): void {
  for (const result of results) expect(() => entryOf(result)).not.toThrow();
}

describe('every fixture', () => {
  const files = ['jest', 'pytest', 'playwright', 'gotestsum']
    .flatMap((dialect) => fixtureXmlFiles(dialect))
    .concat(
      ['surefire-reports', 'surefire-reports-rerun', 'surefire-reports-phrased'].flatMap((folder) =>
        fixtureXmlFiles('surefire', folder),
      ),
    );

  it.each(files.map((file) => [file.slice(FIXTURES_DIR.length), file]))(
    '%s is detected and converts into sendable results',
    (name, file) => {
      const { dialect, results, warnings } = convert(file, { attachOutput: true });
      expect(dialect).toBe(name.split('/')[0]);
      expect(results.length).toBeGreaterThan(0);
      expect(warnings).toEqual([]);
      expectEverySendable(results);
    },
  );
});

describe('jest (jest-junit)', () => {
  const file = fixturePath('jest', 'junit.xml');

  it('uses the name alone, since classname duplicates it, and links the ids in it', () => {
    const { dialect, results } = convert(file);
    expect(dialect).toBe('jest');
    expect(results).toHaveLength(10);

    const linked = find(results, 'login logs in with a valid password');
    expect(linked).toMatchObject({
      caseDisplayId: 'PRB-12',
      status: 'passed',
      durationMs: 1,
      suitePath: ['login'],
    });
    expect(entryOf(linked)).toMatchObject({
      title: 'login logs in with a valid password',
      // jest-junit writes UTC without an offset.
      executedAt: '2026-09-29T18:47:29.000Z',
    });

    // A test outside any describe: leading space, suite named "undefined".
    const topLevel = find(results, 'top-level test outside any describe');
    expect(topLevel.caseDisplayId).toBe('PRB-13');
    expect(entryOf(topLevel).suitePath).toBeUndefined();
  });

  it('maps a bare failure and a skip', () => {
    const { results } = convert(file);

    const failed = find(results, 'login rejects a wrong password');
    expect(failed.status).toBe('failed');
    expect(entryOf(failed).notes).toMatch(/^Error: expect\(received\)\.toBe\(expected\)/);
    expect(find(results, 'login crashes on an unexpected exception').status).toBe('failed');

    const skipped = find(results, 'login supports SSO (skipped: SSO provider not configured)');
    expect(skipped.status).toBe('skipped');
    expect(skipped.notes).toBeUndefined();
  });

  it('puts the file first in the key when jest-junit adds the file attribute', () => {
    const { results } = convert(fixturePath('jest', 'junit-add-file-attribute.xml'));

    const linked = find(
      results,
      'src/__tests__/login.test.js > login logs in with a valid password',
    );
    expect(linked.caseDisplayId).toBe('PRB-12');
    expect(entryOf(linked).suitePath).toEqual(['src/__tests__/login.test.js']);
    find(results, 'src/__tests__/top-level.test.js > top-level test outside any describe');
  });

  it('never attaches suite-level console output to a test', () => {
    const { results } = convert(fixturePath('jest', 'junit-include-console-output.xml'), {
      attachOutput: true,
    });
    expect(results.flatMap((result) => result.attachments ?? [])).toEqual([]);
  });
});

describe('pytest', () => {
  const file = fixturePath('pytest', 'junit.xml');

  it('builds the key from classname and name, and the suites from the module path', () => {
    const { dialect, results } = convert(file);
    expect(dialect).toBe('pytest');
    expect(results).toHaveLength(13);

    const nested = find(
      results,
      'tests.test_login.TestSession.TestRefresh > test_renews_the_token_before_expiry',
    );
    expect(nested).toMatchObject({
      status: 'passed',
      durationMs: 0,
      suitePath: ['tests', 'test_login', 'TestSession', 'TestRefresh'],
    });
    expect(entryOf(nested)).toMatchObject({
      title: 'test_renews_the_token_before_expiry',
      executedAt: '2026-09-29T18:48:02.212Z',
    });
  });

  it('links a record_property id and a name token, and ignores a lowercase lookalike', () => {
    const { results } = convert(file);

    expect(find(results, 'tests.test_login > test_records_a_probara_case_property')).toMatchObject({
      caseDisplayId: 'PRB-13',
    });
    const parameterized = find(
      results,
      'tests.test_login > test_unicode_parameter_ids[accepts caf\\xe9]',
    );
    expect(parameterized.caseDisplayId).toBe('PRB-14');
    expect(entryOf(parameterized).title).toBe('test_unicode_parameter_ids[accepts caf\\xe9]');
    expect(
      find(results, 'tests.test_login > test_prb_12_logs_in_with_a_valid_password').caseDisplayId,
    ).toBeUndefined();
  });

  it('maps failures, a setup error (blocked on request) and a skip with its reason', () => {
    const { results } = convert(file);

    const failed = find(results, 'tests.test_login > test_rejects_a_wrong_password');
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatchObject({
      message: expect.stringMatching(/^AssertionError: assert 'denied' == 'granted'/) as string,
      stack: expect.stringContaining('tests/test_login.py:12: AssertionError') as string,
    });
    expect(find(results, 'tests.test_login > test_errors_in_fixture_setup').status).toBe('failed');
    expect(find(results, 'tests.test_login > test_supports_sso')).toMatchObject({
      status: 'skipped',
      notes: 'Skipped: SSO provider not configured',
    });

    const blocked = convert(file, { errorStatus: 'blocked' }).results;
    expect(find(blocked, 'tests.test_login > test_errors_in_fixture_setup').status).toBe('blocked');
    expect(find(blocked, 'tests.test_login > test_rejects_a_wrong_password').status).toBe('failed');
  });

  it('builds the same keys under junit_family=xunit1, which adds a file attribute', () => {
    const xunit2 = convert(file).results.map(keyOf);
    const xunit1 = convert(fixturePath('pytest', 'junit-xunit1.xml')).results.map(keyOf);
    expect(xunit1).toEqual(xunit2);
  });

  it('attaches the captured output of junit_logging=all on request', () => {
    const logging = fixturePath('pytest', 'junit-logging-all.xml');
    expect(convert(logging).results.flatMap((result) => result.attachments ?? [])).toEqual([]);

    const { results } = convert(logging, { attachOutput: true });
    const printed = find(results, 'tests.test_login > test_prints_to_stdout_and_stderr');
    expect(printed.attachments).toEqual([
      {
        name: 'system-out.txt',
        contentType: 'text/plain',
        body: expect.stringContaining('hello from stdout') as string,
      },
      {
        name: 'system-err.txt',
        contentType: 'text/plain',
        body: expect.stringContaining('hello from stderr') as string,
      },
    ]);
    // A skipped test gets its output pair twice: still one file each.
    expect(find(results, 'tests.test_login > test_supports_sso').attachments).toHaveLength(2);
  });
});

describe('playwright', () => {
  const file = fixturePath('playwright', 'junit.xml');

  it('splits the name into describes and title, with the project as a parameter', () => {
    const { dialect, results } = convert(file);
    expect(dialect).toBe('playwright');
    expect(results).toHaveLength(13);

    const linked = find(
      results,
      'login.spec.js > login > logs in with a valid password [project=node]',
    );
    expect(linked).toMatchObject({ caseDisplayId: 'PRB-12', status: 'passed', durationMs: 3 });
    expect(entryOf(linked)).toMatchObject({
      title: 'logs in with a valid password [project=node]',
      suitePath: ['login.spec.js', 'login'],
      executedAt: '2026-09-29T18:49:25.039Z',
    });
    find(
      results,
      'login.spec.js > login > session > refresh > renews the token before expiry [project=node]',
    );
    expect(
      find(results, 'login.spec.js > top-level test outside any describe [project=node]')
        .caseDisplayId,
    ).toBe('PRB-14');
    expect(
      find(results, 'login.spec.js > login > records a probara case annotation [project=node]')
        .caseDisplayId,
    ).toBe('PRB-13');
  });

  it('maps expect failures, thrown errors and a skip reason from its property', () => {
    const { results } = convert(file);

    const failed = find(results, 'login.spec.js > login > rejects a wrong password [project=node]');
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatchObject({
      message: 'expect(received).toBe(expected) // Object.is equality',
    });
    expect(
      find(results, 'login.spec.js > login > crashes on an unexpected exception [project=node]')
        .status,
    ).toBe('failed');

    const skipped = find(results, 'login.spec.js > login > supports SSO [project=node]');
    expect(skipped).toMatchObject({
      status: 'skipped',
      notes: 'Skipped: SSO provider not configured',
    });
    expect(skipped.durationMs).toBeUndefined();
  });

  it('attaches the files of [[ATTACHMENT|…]] lines as absolute paths', () => {
    const { results } = convert(file);

    const attached = find(
      results,
      'login.spec.js > login > attaches a file and a body [project=node]',
    );
    expect(attached.attachments).toEqual([
      {
        path: fixturePath(
          'playwright',
          'test-results/login-login-attaches-a-file-and-a-body-node/attachments/screenshot-d516c9e4c216254ec17b0ad7165692625a123858.png',
        ),
        contentType: 'image/png',
      },
      {
        path: fixturePath(
          'playwright',
          'test-results/login-login-attaches-a-file-and-a-body-node/attachments/server-log-acf9bee243e170b80ecf4d637ac2ea2191373daa.txt',
        ),
        contentType: 'text/plain',
      },
    ]);
    const paths = results.flatMap((result) => result.attachments ?? []).map((a) => a.path ?? '');
    expect(paths).toHaveLength(7);
    for (const path of paths) {
      expect(isAbsolute(path)).toBe(true);
      expect(existsSync(path)).toBe(true);
    }
  });

  it('attaches stdout and stderr without the attachment lines on request', () => {
    const { results } = convert(file, { attachOutput: true });

    expect(
      find(results, 'login.spec.js > login > prints to stdout and stderr [project=node]')
        .attachments,
    ).toEqual([
      {
        name: 'system-out.txt',
        contentType: 'text/plain',
        body: 'hello from stdout\nraw stdout line\n',
      },
      {
        name: 'system-err.txt',
        contentType: 'text/plain',
        body: 'hello from stderr\nraw stderr line\n',
      },
    ]);
    // Only attachment lines: no output file.
    expect(
      find(results, 'login.spec.js > login > attaches a file and a body [project=node]')
        .attachments,
    ).toHaveLength(2);
  });

  it('builds the same keys with retries and the project in the name, and notes the attempts', () => {
    const retries = fixturePath('playwright', 'junit-include-retries.xml');
    const { results } = convert(retries);
    expect(results.map(keyOf)).toEqual(convert(file).results.map(keyOf));

    const flaky = find(
      results,
      'login.spec.js > login > is flaky and passes on retry [project=node]',
    );
    expect(flaky.status).toBe('passed');
    expect(flaky.notes).toMatch(/^Passed after 1 failed attempt\./);
    expect(flaky.notes).toContain('expect(received).toBe(expected) // Object.is equality');

    const failed = find(results, 'login.spec.js > login > rejects a wrong password [project=node]');
    expect(failed).toMatchObject({ status: 'failed', notes: 'Failed in all 2 attempts.' });
    // The retry's error context sits inside its attempt: still attached.
    expect(failed.attachments).toHaveLength(2);
  });
});

describe('surefire', () => {
  const reports = (folder: string) =>
    fixtureXmlFiles('surefire', folder).flatMap((path) => convert(path).results);

  it('builds the key from the class and the method, and the suites from the class nesting', () => {
    const results = reports('surefire-reports');
    expect(results).toHaveLength(11);

    const nested = find(
      results,
      'me.probara.fixture.LoginTest$Session$Refresh > renewsTheTokenBeforeExpiry',
    );
    expect(nested).toMatchObject({
      status: 'passed',
      durationMs: 0,
      suitePath: ['me.probara.fixture.LoginTest', 'Session', 'Refresh'],
    });
    expect(nested.startedAt).toBeUndefined();
    expect(entryOf(nested).title).toBe('renewsTheTokenBeforeExpiry');
    expect(
      find(results, 'me.probara.fixture.LoginTest > usernameLength(String, int)[1]').suitePath,
    ).toEqual(['me.probara.fixture.LoginTest']);
  });

  it('maps failures, errors and a skip reason', () => {
    const results = reports('surefire-reports');

    const failed = find(results, 'me.probara.fixture.LoginTest > rejectsAWrongPassword');
    expect(failed).toMatchObject({ status: 'failed', durationMs: 2 });
    expect(failed.error).toMatchObject({
      message: 'password check ==> expected: <granted> but was: <denied>',
    });
    expect(
      find(results, 'me.probara.fixture.LoginTest > crashesOnAnUnexpectedException').status,
    ).toBe('failed');
    expect(find(results, 'me.probara.fixture.LoginTest > supportsSso')).toMatchObject({
      status: 'skipped',
      notes: 'Skipped: SSO provider not configured',
    });
    expect(find(results, 'me.probara.fixture.FlakyTest > passesOnTheSecondAttempt').status).toBe(
      'failed',
    );
  });

  it('links an id in a display name', () => {
    const results = reports('surefire-reports-phrased');
    expect(
      find(results, 'me.probara.fixture.LoginTest > logs in with a valid password').caseDisplayId,
    ).toBe('PRB-12');
  });

  it('notes flaky and rerun attempts', () => {
    const results = reports('surefire-reports-rerun');

    const flaky = find(results, 'me.probara.fixture.FlakyTest > passesOnTheSecondAttempt');
    expect(flaky.status).toBe('passed');
    expect(flaky.notes).toBe(
      'Passed after 1 failed attempt.\n\nFirst failure: fails on the first attempt only ==> expected: <true> but was: <false>',
    );
    expect(find(results, 'me.probara.fixture.LoginTest > rejectsAWrongPassword')).toMatchObject({
      status: 'failed',
      notes: 'Failed in all 3 attempts.',
    });
  });

  it('attaches per-test output on request', () => {
    const [login] = fixtureXmlFiles('surefire', 'surefire-reports').filter((path) =>
      path.endsWith('LoginTest.xml'),
    );
    const { results } = convert(login ?? '', { attachOutput: true });
    expect(
      find(results, 'me.probara.fixture.LoginTest > printsToStdoutAndStderr').attachments,
    ).toEqual([
      { name: 'system-out.txt', contentType: 'text/plain', body: 'hello from stdout\n' },
      { name: 'system-err.txt', contentType: 'text/plain', body: 'hello from stderr\n' },
    ]);
  });
});

describe('gotestsum', () => {
  const file = fixturePath('gotestsum', 'junit.xml');

  it('builds the key from the package and the subtest path, dropping parent tests', () => {
    const { dialect, results } = convert(file);
    expect(dialect).toBe('gotestsum');
    // 16 testcases, minus the parents TestLogin, TestLogin/session and TestUsernameLength.
    expect(results).toHaveLength(13);
    const keys = results.map(keyOf);
    expect(keys).not.toContain('example.com/probarafixture/auth > TestLogin');
    expect(keys).not.toContain('example.com/probarafixture/auth > TestLogin > session');
    expect(keys).not.toContain('example.com/probarafixture/auth > TestUsernameLength');

    const linked = find(
      results,
      'example.com/probarafixture/auth > TestLogin > logs_in_with_a_valid_password',
    );
    expect(linked).toMatchObject({ caseDisplayId: 'PRB-12', status: 'passed', durationMs: 0 });
    expect(entryOf(linked)).toMatchObject({
      title: 'logs_in_with_a_valid_password',
      suitePath: ['example.com/probarafixture/auth', 'TestLogin'],
      executedAt: '2026-09-29T18:51:54.000Z',
    });
    find(
      results,
      'example.com/probarafixture/auth > TestLogin > session > refresh_renews_the_token_before_expiry',
    );
    find(results, 'example.com/probarafixture/auth > TestUsernameLength > alice');
  });

  it('maps failures, a panic and skip reasons from the test output', () => {
    const { results } = convert(file);

    const failed = find(results, 'example.com/probarafixture/auth > TestRejectsAWrongPassword');
    expect(failed.status).toBe('failed');
    expect(entryOf(failed).notes).toBe(
      '=== RUN   TestRejectsAWrongPassword\n    auth_test.go:17: Login("wrong") = false, want true\n--- FAIL: TestRejectsAWrongPassword (0.00s)',
    );
    expect(
      entryOf(find(results, 'example.com/probarafixture/billing > TestCrashesOnAnUnexpectedPanic'))
        .notes,
    ).toContain('panic: assignment to entry in nil map');
    expect(find(results, 'example.com/probarafixture/auth > TestSupportsSSO')).toMatchObject({
      status: 'skipped',
      notes: 'Skipped: SSO provider not configured',
    });
    expect(
      find(results, 'example.com/probarafixture/auth > TestLogin > skipped_subtest').notes,
    ).toBe('Skipped: not implemented yet');
  });

  it('uses the short package names when gotestsum writes them', () => {
    const { results } = convert(fixturePath('gotestsum', 'junit-short-names.xml'));
    expect(results).toHaveLength(13);
    find(results, 'auth > TestLogin > logs_in_with_a_valid_password');
    find(results, 'billing > TestChargesTheCard');
  });
});
