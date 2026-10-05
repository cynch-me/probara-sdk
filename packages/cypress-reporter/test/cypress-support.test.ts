/**
 * The `probara.*` helpers of the browser, in a real `cypress run`: what a spec tells the reporter,
 * how it lands on the attempt it belongs to (a helper in a `beforeEach`, in an `afterEach`, in a
 * suite-level `before`), and what the run selection leaves out of the report.
 *
 * The specs of this file live in the fixture project of `test/support/project.ts`; the run is the
 * user's: the built reporter by its package name, the built core, and a fake Probara.
 */
import type { ReportRequest } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPTURE, RETRIES, SELECTION } from './support/project.js';
import {
  createWorkspace,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const SPEC = 'cypress/e2e/helpers.cy.js';
/** Cypress starts in seconds: a run of one spec takes a while, and there are several here. */
const TIMEOUT = 300_000;

/** Every result Probara received, in the order it was sent. */
function resultsOf(probara: FakeProbara): ReportRequest['results'] {
  return probara.reports().flatMap((report) => report.results);
}

/** The result of the test whose full name ends with `title`, its attempts in order. */
function resultsOfTest(probara: FakeProbara, title: string): ReportRequest['results'] {
  return resultsOf(probara).filter((result) => result.automationKey?.endsWith(title) === true);
}

/** The `[probara]` lines of a run, without the ones core logs at debug. */
function probaraLines(run: CommandRun): string[] {
  return `${run.stdout}${run.stderr}`
    .split('\n')
    .filter((line) => line.includes('[probara]'))
    .map((line) => line.trim());
}

/** The console of a fake Probara, and the workspace and run of a `cypress run` against it. */
interface Run {
  fake: FakeProbara;
  workspace: Workspace;
  run: CommandRun;
}

/** A workspace with the specs of the helpers, and no spec Cypress cannot parse. */
async function helpersWorkspace(): Promise<Workspace> {
  return createWorkspace('helpers', { broken: false });
}

describe('a real cypress run whose specs call the probara.* helpers', () => {
  let all: Run;

  beforeAll(async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const workspace = await helpersWorkspace();
    const run = await workspace.cypress(
      ['--browser', 'electron', '--spec', SPEC],
      probaraEnv(fake.baseUrl, { [RETRIES]: '0' }),
    );
    all = { fake, workspace, run };
  }, TIMEOUT);

  afterAll(async () => {
    await all.fake.close();
    await all.workspace.remove();
  });

  it('runs the spec of the helpers and reports every test of it', () => {
    // Two tests fail on purpose (a step that throws, a step whose command fails): every test that
    // ran is reported, and the run fails on the two the spec fails on.
    expect(all.run.exitCode).toBe(2);
    expect(resultsOf(all.fake).map((result) => [result.automationKey, result.status])).toEqual([
      [`${SPEC} > Helpers says everything a helper can`, 'passed'],
      [`${SPEC} > Helpers takes a wrong argument without failing`, 'passed'],
      [`${SPEC} > Helpers attaches a body, a file, and a file inside a step`, 'passed'],
      [`${SPEC} > Helpers runs nested steps`, 'passed'],
      [`${SPEC} > Helpers ends a step that throws as failed, and the test fails too`, 'failed'],
      [`${SPEC} > Helpers leaves a step unfinished when its command fails`, 'failed'],
      [`${SPEC} > Helpers writes to the console`, 'passed'],
      [`${SPEC} > Hooks takes what its own hooks said`, 'passed'],
    ]);
    expect(`${all.run.stdout}${all.run.stderr}`).not.toContain(TOKEN);
  });

  it('sends what each helper said with the result of the test it was called in', () => {
    const [said] = resultsOfTest(all.fake, 'says everything a helper can');
    // The case id links the result to the case; the title, the suite and the fields describe the
    // case the report creates for it, and the id never enters the key.
    expect(said?.caseDisplayId).toBe('SHOP-12');
    expect(said?.automationKey).toBe(`${SPEC} > Helpers says everything a helper can`);
    expect(said?.title).toBe('Adds an item');
    // `probara.suite(['Cart', 'Checkout'])` names the suites of the created case, and they replace
    // the ones of the spec path and the describe.
    expect(said?.suitePath).toEqual(['Cart', 'Checkout']);
    // A test that says nothing about its suite keeps the spec file and its describe.
    expect(resultsOfTest(all.fake, 'runs nested steps')[0]?.suitePath).toEqual([SPEC, 'Helpers']);
    expect(said?.case?.tags).toEqual(['smoke', 'cart']);
    expect(said?.case?.fields).toMatchObject({ severity: 'high' });
    expect(said?.parameters).toMatchObject({ build: '42', ok: 'true', browser: 'electron' });
    expect(said?.notes).toContain('from the cart');
  });

  it('drops an issue with no issueUrlTemplate, and links what the test gave a URL to', () => {
    const [said] = resultsOfTest(all.fake, 'says everything a helper can');
    // `probara.issue('PRB-7')` needs a template; `probara.link` has one already.
    expect(said?.links).toEqual([{ name: 'Build', url: 'https://ci.example.com/build/12' }]);
  });

  it('attaches a body, a file read from the project root, and a file inside a step', () => {
    const files = all.fake.stagedFiles().filter((file) => !file.name.endsWith('.png'));
    expect(files.map((file) => [file.name, file.type, file.size])).toEqual([
      // The body and the file the test attached by path, with the type of its extension.
      ['note.txt', 'text/plain', 6],
      ['cart.csv', 'text/csv', 'sku,qty\nA-1,2\nB-7,1\n'.length],
      ['inside.txt', 'text/plain', 'inside the step'.length],
    ]);
    // The file attached inside the step went to that step of the result, not to the result beside
    // it: the API commits an attachment with the index of the step it belongs to.
    const commits = all.fake
      .requestsTo('commit')
      .flatMap(
        (request) => (request.body as { attachments?: { stepIndex?: number }[] }).attachments ?? [],
      );
    expect(commits.filter((attachment) => attachment.stepIndex === 0)).toHaveLength(1);
    // Every file reached Probara, none of them skipped: three of them, and the two screenshots
    // Cypress took of the tests that fail.
    expect(probaraLines(all.run).find((line) => line.includes('Attached'))).toContain(
      '5 files to results (0 skipped, 0 failed)',
    );
  });

  it('nests the steps a test ran, and keeps what the outermost one expects', () => {
    const [said] = resultsOfTest(all.fake, 'runs nested steps');
    // The steps of the created case are the outermost ones, as in every other reporter: what a
    // step declares is what the case the report creates holds for it.
    expect(said?.case?.steps).toEqual([
      { action: 'Adds an item', expected: 'The cart holds one item', data: '{"sku":"A-1"}' },
    ]);
    expect(said?.steps).toEqual([
      expect.objectContaining({
        action: 'Adds an item',
        expected: 'The cart holds one item',
        data: '{"sku":"A-1"}',
        status: 'passed',
        steps: [expect.objectContaining({ action: 'Finds the cart', status: 'passed' })],
      }),
    ]);
  });

  it('fails a step that throws, with the error it threw, and fails its test', () => {
    const [said] = resultsOfTest(
      all.fake,
      'ends a step that throws as failed, and the test fails too',
    );
    // Cypress fails a test whose body throws before it runs the commands that body queued, and the
    // lines of the step are commands: the failure is reported, the step itself is not (a step that
    // fails through a Cypress command is reported, as the next test shows).
    expect(said?.status).toBe('failed');
    expect(said?.notes).toContain('the step failed');
    expect(said?.steps).toBeUndefined();
  });

  it('fails a step whose command failed, naming it unfinished', () => {
    const [said] = resultsOfTest(all.fake, 'leaves a step unfinished when its command fails');
    expect(said?.steps).toEqual([
      {
        action: 'Fails on purpose too',
        status: 'failed',
        error: 'The step had not finished when the test ended',
      },
    ]);
  });

  it("gives a test what its own beforeEach and afterEach said, and never another test's", () => {
    const [said] = resultsOfTest(all.fake, 'takes what its own hooks said');
    // One comment per result, like the Jest reporter: the last one said wins. The `afterEach`'s
    // reached the result of its own test, so it is that one (and no other test carries it).
    expect(said?.notes).toContain('from the afterEach');
    expect(
      resultsOf(all.fake)
        .filter((result) => result.notes?.includes('from the afterEach') === true)
        .map((result) => result.automationKey),
    ).toEqual([`${SPEC} > Hooks takes what its own hooks said`]);
    // The `beforeEach` of that test said a comment too, and it was said by that test alone.
    expect(resultsOfTest(all.fake, 'runs nested steps')[0]?.notes).toBeUndefined();
  });

  it('drops what a suite hook said before any test ran, with one warning', () => {
    // The `before` of the describe ran before its first test (Cypress already names that test as
    // the running one), and no attempt of this spec had begun: its message belongs to none, and one
    // warning says so instead of giving it to the test that ran next.
    expect(resultsOfTest(all.fake, 'says everything a helper can')[0]?.title).toBe('Adds an item');
    const warnings = probaraLines(all.run).filter((line) => line.includes('belongs to no attempt'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('probara.title()');
    expect(warnings[0]).toContain(SPEC);
    expect(warnings[0]).toContain('Left out 1 probara.* call');
  });

  it('gives a helper of the after of the suite to the last test of it, as Cypress names it', () => {
    // Cypress still names the last test of a describe as the running one in the describe's `after`
    // hook, so what a helper says there is that test's own: nothing is dropped, nothing is invented.
    expect(resultsOfTest(all.fake, 'writes to the console')[0]?.title).toBe(
      'Said after the last test ended',
    );
  });

  it('warns once about a wrong argument, and the test still passes', () => {
    expect(resultsOfTest(all.fake, 'takes a wrong argument without failing')[0]?.status).toBe(
      'passed',
    );
    expect(
      probaraLines(all.run).filter((line) => line.includes('probara.link() takes an absolute')),
    ).toEqual([expect.stringContaining('first seen in')]);
  });

  it('captures no console output unless the reporter was asked to', () => {
    // `captureOutput` is off by default: the test wrote to the console and nothing was uploaded.
    expect(resultsOfTest(all.fake, 'writes to the console')).toHaveLength(1);
    expect(all.fake.stagedFiles().map((file) => file.name)).not.toContain('stdout.log');
    expect(all.fake.stagedFiles().map((file) => file.name)).not.toContain('stderr.log');
  });
});

describe('a run whose reporter captures the console output of each test', () => {
  let captured: Run;

  beforeAll(async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const workspace = await helpersWorkspace();
    const run = await workspace.cypress(
      ['--browser', 'electron', '--spec', SPEC],
      probaraEnv(fake.baseUrl, { [RETRIES]: '0', [CAPTURE]: '1' }),
    );
    captured = { fake, workspace, run };
  }, TIMEOUT);

  afterAll(async () => {
    await captured.fake.close();
    await captured.workspace.remove();
  });

  it('attaches what each test wrote as stdout.log and stderr.log', () => {
    // The screenshots of the two tests that fail on purpose are attached too; the logs of the
    // console are the two files this is about.
    // The same spec attaches its own files too; the logs of the console are the two this is about.
    const files = captured.fake.stagedFiles().filter((file) => file.name.endsWith('.log'));
    const of = (name: string) => files.find((file) => file.name === name);
    expect(of('stdout.log')?.type).toBe('text/plain');
    expect(of('stderr.log')?.type).toBe('text/plain');
    // Both streams of the one test that wrote to the console, and nothing of the others: a test
    // that wrote nothing has no log of its own.
    expect(files.map((file) => file.name).sort()).toEqual(['stderr.log', 'stdout.log']);
    expect(of('stdout.log')?.size).toBe('a line of stdout\n'.length);
    expect(of('stderr.log')?.size).toBe('a line of stderr\n'.length);
  });

  it('sends one buffer per test, not one per stream for the whole spec', () => {
    // Eight tests ran and one of them wrote to the console: two files, and no other test's output
    // in them (the sizes are what that one test wrote).
    const logs = captured.fake
      .stagedFiles()
      .filter((file) => file.name.endsWith('.log'))
      .map((file) => [file.name, file.size])
      .sort();
    expect(logs).toEqual([
      ['stderr.log', 'a line of stderr\n'.length],
      ['stdout.log', 'a line of stdout\n'.length],
    ]);
    // And every file of the run reached Probara, none of them skipped.
    expect(probaraLines(captured.run).find((line) => line.includes('Attached'))).toContain(
      '(0 skipped, 0 failed)',
    );
  });
});

describe('a run whose Cypress config registers no plugin, with the support file loaded', () => {
  let none: Run;

  beforeAll(async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const workspace = await createWorkspace('no-plugin', { broken: false, helpers: true });
    const run = await workspace.cypress(
      ['--browser', 'electron', '--spec', SPEC],
      probaraEnv(fake.baseUrl),
    );
    none = { fake, workspace, run };
  }, TIMEOUT);

  afterAll(async () => {
    await none.fake.close();
    await none.workspace.remove();
  });

  it('runs every test all the same, and the helpers of the browser do nothing', () => {
    // Two of the specs' tests fail on purpose, whatever the helpers said: the support file found no
    // plugin, every helper is a no-op, and the run is reported by the reporter process alone.
    const reported = resultsOf(none.fake);
    expect(reported.map((result) => result.status)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
      'failed',
      'failed',
      'passed',
      'passed',
    ]);
    // Nothing of the helpers reached the results: no comment, no step and no file of its own
    // (the case the report creates is titled after the key, as it is without the helpers).
    expect(reported.some((result) => result.notes?.includes('from the ') === true)).toBe(false);
    expect(reported.every((result) => result.steps === undefined)).toBe(true);
    expect(reported.some((result) => result.parameters?.['build'] !== undefined)).toBe(false);
    // Nothing of `probara.attach` either: the run attached no file at all (the no-plugin config
    // takes no screenshot).
    expect(none.fake.stagedFiles()).toEqual([]);
    expect(none.run.exitCode).toBe(2);
    expect(`${none.run.stdout}${none.run.stderr}`).not.toContain(TOKEN);
  });
});

describe('a run that takes only the tests of the cases of a run (runCasesOnly)', () => {
  let selected: Run;

  beforeAll(async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    // The run holds one case whose key is the key of a test of the spec.
    const runUlid = fake.seedRun({
      cases: [
        {
          caseDisplayId: 'SHOP-12',
          automationKey: `${SPEC} > Helpers says everything a helper can`,
        },
      ],
    });
    const workspace = await helpersWorkspace();
    const run = await workspace.cypress(
      ['--browser', 'electron', '--spec', SPEC],
      probaraEnv(fake.baseUrl, {
        [RETRIES]: '0',
        [SELECTION]: '1',
        PROBARA_RUN_ULID: runUlid,
      }),
    );
    selected = { fake, workspace, run };
  }, TIMEOUT);

  afterAll(async () => {
    await selected.fake.close();
    await selected.workspace.remove();
  });

  it('runs the tests the run takes and leaves the rest out of the report', () => {
    const reported = resultsOf(selected.fake).map((result) => result.automationKey);
    // Only the test the run's case names is reported: the others were skipped, not reported.
    expect(reported).toEqual([`${SPEC} > Helpers says everything a helper can`]);
  });

  it('says how many tests matched the cases of the run, in the Jest reporter wording', () => {
    const line = probaraLines(selected.run).find((each) => each.includes('Ran only the tests'));
    expect(line).toMatch(
      /^\[probara\] Ran only the tests of run [0-9A-Z]{26}: 1 of 8 tests match its cases; 7 skipped and not reported$/,
    );
    // The run the selection took its cases from is the one the run reported into, and it stays open:
    // a reused run (`run.ulid`) is never closed by a report.
    expect(selected.fake.runs().map((created) => created.state)).toEqual(['open']);
  });
});
