/**
 * The automation keys of the reporter and of `probara import junit` on the output of Cypress's
 * built-in `junit` reporter, over one suite and one project: two `cypress run` invocations of the
 * same specs, the first with `@probara/cypress-reporter` and a fake Probara, the second with
 * `reporter: 'junit'` (the mocha-junit-reporter Cypress bundles) writing the JUnit the CLI then
 * reads, as its `cypress-junit` dialect. What a team moving from the import to the reporter must keep is that both
 * paths name the same tests: the same key for every test of the suite.
 *
 * The suite holds every shape the two paths can disagree on, and `retries.runMode: 1` is on in
 * both runs, so the difference between one result per attempt and one result per test is real.
 * Cypress starts in about ten seconds, so the two runs are made once and every assertion reads them.
 */
import { readdir } from 'node:fs/promises';
import type { ReportResultEntry } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JUNIT_REPORTER } from './support/project.js';
import { ensureCypressBinary } from './support/cypress-binary.js';
import { createWorkspace, probaraEnv, TOKEN, type Workspace } from './support/workspace.js';

/** A real `cypress run` needs the binary, and a machine without one says so once, here. */
beforeAll(() => ensureCypressBinary());

/** The specs of the parity suite, both of the paths' runs. */
const SPECS = 'cypress/e2e/{parity-suite,parity-root}.cy.js';
/** Two `cypress run` invocations of the suite, and the CLI over what the second one wrote. */
const TIMEOUT = 300_000;

const SUITE = 'cypress/e2e/parity-suite.cy.js';
const ROOT = 'cypress/e2e/parity-root.cy.js';
/** The test the always failing hook was running, named the way Cypress names the failure. */
const HOOK_FAILURE = `${SUITE} > Always "before each" hook for "never runs"`;

/**
 * Every key the reporter reported and the import did not, and why: the two tests a `beforeEach`
 * that fails on every attempt takes away from a suite.
 *
 * - `Always never runs` — the attempt Cypress is about to retry, which the reporter reports as a
 *   result of its own (the `retry` event) and the junit reporter never sees: it listens for
 *   `pass`, `fail` and `pending`, so the retry of a hook is in no JUnit it writes.
 * - `Always never runs either` — the test the failing hook kept from running. The reporter walks
 *   the suite when it ends and reports it as skipped; a test that never ran emits no event at all,
 *   so the import never hears of it.
 *
 * Neither is a key the other path would rename: they are the two results the reporter adds by
 * design, and every other test of the suite is named the same by both.
 */
const ONLY_REPORTER = [`${SUITE} > Always never runs`, `${SUITE} > Always never runs either`];

/** Every result Probara received, in the order it was sent. */
function resultsOf(probara: FakeProbara): ReportResultEntry[] {
  return probara.reports().flatMap((report) => report.results);
}

/** Every automation key Probara received, once each, in the order it was first sent. */
function keysOf(probara: FakeProbara): string[] {
  return [...new Set(resultsOf(probara).map((result) => result.automationKey ?? ''))];
}

/** The status of every attempt of every key, in the order the attempts were sent. */
function statusesOf(probara: FakeProbara): Record<string, string[]> {
  const statuses: Record<string, string[]> = {};
  for (const result of resultsOf(probara))
    (statuses[result.automationKey ?? ''] ??= []).push(result.status);
  return statuses;
}

/** What each side named a test: the title its case is created with, and the case it links. */
function namesOf(probara: FakeProbara): Record<string, { title?: string; id?: string }> {
  const names: Record<string, { title?: string; id?: string }> = {};
  for (const result of resultsOf(probara))
    names[result.automationKey ?? ''] = {
      ...(result.title === undefined ? {} : { title: result.title }),
      ...(result.caseDisplayId === undefined ? {} : { id: result.caseDisplayId }),
    };
  return names;
}

/** The suite each key's case belongs to: the spec and its describes, or the spec alone. */
function suitesOf(probara: FakeProbara): Record<string, readonly string[] | undefined> {
  return Object.fromEntries(
    resultsOf(probara).map((result) => [result.automationKey ?? '', result.suitePath]),
  );
}

/** The JUnit files the built-in `junit` reporter wrote in `dir`, in the order it wrote them. */
async function junitFilesOf(dir: string): Promise<string[]> {
  const files = await readdir(dir);
  return files.filter((file) => /^junit-[\da-f]+\.xml$/.test(file));
}

describe('the keys of the reporter and of probara import junit on the built-in junit reporter', () => {
  let reported: FakeProbara;
  let imported: FakeProbara;
  let workspace: Workspace;
  let junitFiles: string[] = [];
  const timings: string[] = [];

  beforeAll(async () => {
    reported = await startFakeProbara({ token: TOKEN });
    imported = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace('parity', { broken: false });

    // The first path: the reporter, in the project a user lays out, reporting to its own fake.
    let started = Date.now();
    const reportedRun = await workspace.cypress(
      ['--browser', 'electron', '--spec', SPECS],
      probaraEnv(reported.baseUrl, { PROBARA_PROJECT: 'PRB' }),
    );
    timings.push(`reporter ${((Date.now() - started) / 1000).toFixed(1)}s`);
    // Cypress ends with the number of failed tests (five of them, over two specs); reporting
    // changes nothing of it.
    expect(reportedRun.exitCode).toBe(5);

    // The second path: the same specs with Cypress's built-in `junit` reporter, which writes the
    // JUnit instead of reporting anything. It reads nothing of Probara's environment, so the run
    // has none.
    started = Date.now();
    const junitRun = await workspace.cypress(['--browser', 'electron', '--spec', SPECS], {
      [JUNIT_REPORTER]: '1',
    });
    timings.push(`junit ${((Date.now() - started) / 1000).toFixed(1)}s`);
    expect(junitRun.exitCode).toBe(5);
    junitFiles = await junitFilesOf(workspace.dir);
    // One file per spec, which is what `[hash]` in `mochaFile` is for.
    expect(junitFiles).toHaveLength(2);

    // And `probara import junit` reads them, into the second fake.
    started = Date.now();
    const importRun = await workspace.probara(
      ['import', 'junit', ...junitFiles],
      probaraEnv(imported.baseUrl, { PROBARA_PROJECT: 'PRB' }),
    );
    timings.push(`import ${((Date.now() - started) / 1000).toFixed(1)}s`);
    expect(importRun.exitCode, `${importRun.stdout}${importRun.stderr}`).toBe(0);
    expect(`${importRun.stdout}${importRun.stderr}`).not.toContain(TOKEN);
  }, TIMEOUT);

  afterAll(async () => {
    process.stdout.write(
      `\nparity: ${String(keysOf(reported).length)} keys reported of ` +
        `${String(resultsOf(reported).length)} results, ${String(keysOf(imported).length)} keys ` +
        `imported of ${String(resultsOf(imported).length)} results (${timings.join(', ')})\n`,
    );
    await Promise.all([reported.close(), imported.close()]);
    await workspace.remove();
  });

  it('names every test of the suite the same, apart from the two a failing hook took away', () => {
    const byReporter = keysOf(reported);
    const byImport = keysOf(imported);
    // Both sides named tests: two empty sets would otherwise be equal.
    expect(byReporter).toHaveLength(15);
    expect(byImport).toHaveLength(13);
    // Neither path renames a test the other named: every key of the import is a key of the
    // reporter, and the reporter's other keys are exactly the two a failing hook took away.
    expect(byImport.filter((key) => !byReporter.includes(key))).toEqual([]);
    expect(byReporter.filter((key) => !byImport.includes(key))).toEqual(ONLY_REPORTER);
    // And the two sets together are the suite, key by key. The order is not part of the contract:
    // a reporter walks the specs as Cypress ran them, an import walks the files as it was given
    // them, so the two orders differ by design.
    expect([...byReporter].sort()).toEqual([...byImport, ...ONLY_REPORTER].sort());
  });

  it('names a test the same, and links the same case for it, on both paths', () => {
    // The title both paths send is the full title, the case ids of the titles taken out of it: a
    // `describe` that names one (`PRB-12 Cart`) links every test of it, and a test that names one
    // in its own title (`PRB-12 is paid by invoice`) links itself.
    expect(namesOf(reported)).toMatchObject({
      [`${SUITE} > Cart adds an item`]: { title: 'Cart adds an item', id: 'PRB-12' },
      [`${SUITE} > Cart Refunds Partial refunds one item`]: {
        title: 'Cart Refunds Partial refunds one item',
        id: 'PRB-12',
      },
      [`${SUITE} > Invoice is paid by invoice`]: {
        title: 'Invoice is paid by invoice',
        id: 'PRB-12',
      },
      [`${SUITE} > Reports accepts café and ñandú`]: { title: 'Reports accepts café and ñandú' },
      [`${SUITE} > Reports keeps a -- in its title and fails`]: {
        title: 'Reports keeps a -- in its title and fails',
      },
      [`${ROOT} > runs in the root suite`]: { title: 'runs in the root suite' },
      [HOOK_FAILURE]: { title: 'Always "before each" hook for "never runs"' },
    });
    // Every entry the import has, the reporter agrees with: the same title, the same case, and the
    // case id never inside a key.
    expect(namesOf(reported)).toMatchObject(namesOf(imported));
    expect(keysOf(imported).filter((key) => key.includes('PRB-12'))).toEqual([]);
  });

  it('sends one result per attempt, where the import keeps only the last one', () => {
    // THE DOCUMENTED DIFFERENCE, first of the two: the reporter reports every attempt of a test,
    // so a retry is a result of its own (the `retry` event is a failure the reporter sends), while
    // a JUnit has one testcase per test and the import keeps the last attempt it holds.
    expect(statusesOf(reported)).toEqual({
      [`${ROOT} > runs in the root suite`]: ['passed'],
      // A test that fails on every attempt: two failures, one key.
      [`${ROOT} > fails in the root suite`]: ['failed', 'failed'],
      [`${SUITE} > Cart adds an item`]: ['passed'],
      [`${SUITE} > Cart Checkout pays by card`]: ['passed'],
      [`${SUITE} > Cart Checkout pays with a voucher`]: ['skipped'],
      [`${SUITE} > Cart Refunds Partial refunds one item`]: ['passed'],
      [`${SUITE} > Reports keeps a -- in its title and fails`]: ['failed', 'failed'],
      [`${SUITE} > Reports accepts café and ñandú`]: ['passed'],
      [`${SUITE} > Invoice is paid by invoice`]: ['passed'],
      [`${SUITE} > Failures fails on purpose`]: ['failed', 'failed'],
      [`${SUITE} > Failures throws on purpose`]: ['failed', 'failed'],
      // A hook that fails once: the failed attempt is a result of its own, then the test passes.
      [`${SUITE} > Flaky passes on the retry of its hook`]: ['failed', 'passed'],
      // The two results of the suite a failing hook takes away from (see `ONLY_REPORTER`).
      [`${SUITE} > Always never runs`]: ['failed'],
      [HOOK_FAILURE]: ['failed'],
      [`${SUITE} > Always never runs either`]: ['skipped'],
    });
    expect(statusesOf(imported)).toEqual({
      [`${ROOT} > runs in the root suite`]: ['passed'],
      [`${ROOT} > fails in the root suite`]: ['failed'],
      [`${SUITE} > Cart adds an item`]: ['passed'],
      [`${SUITE} > Cart Checkout pays by card`]: ['passed'],
      [`${SUITE} > Cart Checkout pays with a voucher`]: ['skipped'],
      [`${SUITE} > Cart Refunds Partial refunds one item`]: ['passed'],
      [`${SUITE} > Reports keeps a -- in its title and fails`]: ['failed'],
      [`${SUITE} > Reports accepts café and ñandú`]: ['passed'],
      [`${SUITE} > Invoice is paid by invoice`]: ['passed'],
      [`${SUITE} > Failures fails on purpose`]: ['failed'],
      [`${SUITE} > Failures throws on purpose`]: ['failed'],
      // The one a retry makes the difference for: the reporter's first result is the failed
      // attempt, and the single result the import has is the pass that ended the retry.
      [`${SUITE} > Flaky passes on the retry of its hook`]: ['passed'],
      [HOOK_FAILURE]: ['failed'],
    });
    // Every key the import holds one result for agrees with the last attempt the reporter sent.
    for (const [key, statuses] of Object.entries(statusesOf(imported)))
      expect(statusesOf(reported)[key]?.at(-1), `the last attempt of ${key}`).toBe(statuses[0]);
  });

  it('numbers the attempts of a result, and names the suite of a created case differently', () => {
    // The parameters are the reporter's own: the browser it runs and the number of the attempt.
    // The JUnit has neither, and neither reaches a key — which is what the comparison above proves.
    expect(
      resultsOf(reported).every((result) => result.parameters?.['browser'] === 'electron'),
    ).toBe(true);
    expect(
      resultsOf(reported)
        .filter((result) => result.parameters?.['attempt'] !== undefined)
        .map(
          (result) => `${String(result.parameters?.['attempt'])} ${String(result.automationKey)}`,
        )
        .sort(),
    ).toEqual(
      [
        `2 ${ROOT} > fails in the root suite`,
        `2 ${SUITE} > Reports keeps a -- in its title and fails`,
        `2 ${SUITE} > Failures fails on purpose`,
        `2 ${SUITE} > Failures throws on purpose`,
        `2 ${SUITE} > Flaky passes on the retry of its hook`,
        `2 ${SUITE} > Always "before each" hook for "never runs"`,
      ].sort(),
    );
    expect(resultsOf(imported).every((result) => result.parameters === undefined)).toBe(true);
    // The suite of a created case is the other difference, and the only one a reader sees: the
    // import cannot rebuild the describes of a test (its JUnit holds one title segment), so every
    // case it creates sits in the suite of its spec alone, where the reporter sits it in the suite
    // of the spec and the describes it walked.
    expect(suitesOf(imported)).toEqual({
      [`${ROOT} > runs in the root suite`]: [ROOT],
      [`${ROOT} > fails in the root suite`]: [ROOT],
      [`${SUITE} > Cart adds an item`]: [SUITE],
      [`${SUITE} > Cart Checkout pays by card`]: [SUITE],
      [`${SUITE} > Cart Checkout pays with a voucher`]: [SUITE],
      [`${SUITE} > Cart Refunds Partial refunds one item`]: [SUITE],
      [`${SUITE} > Reports keeps a -- in its title and fails`]: [SUITE],
      [`${SUITE} > Reports accepts café and ñandú`]: [SUITE],
      [`${SUITE} > Invoice is paid by invoice`]: [SUITE],
      [`${SUITE} > Failures fails on purpose`]: [SUITE],
      [`${SUITE} > Failures throws on purpose`]: [SUITE],
      [`${SUITE} > Flaky passes on the retry of its hook`]: [SUITE],
      [HOOK_FAILURE]: [SUITE],
    });
    expect(suitesOf(reported)).toEqual({
      // The tests of the root suite of a spec are in no describe at all.
      [`${ROOT} > runs in the root suite`]: [ROOT],
      [`${ROOT} > fails in the root suite`]: [ROOT],
      [`${SUITE} > Cart adds an item`]: [SUITE, 'Cart'],
      [`${SUITE} > Cart Checkout pays by card`]: [SUITE, 'Cart', 'Checkout'],
      [`${SUITE} > Cart Checkout pays with a voucher`]: [SUITE, 'Cart', 'Checkout'],
      [`${SUITE} > Cart Refunds Partial refunds one item`]: [SUITE, 'Cart', 'Refunds', 'Partial'],
      [`${SUITE} > Reports keeps a -- in its title and fails`]: [SUITE, 'Reports'],
      [`${SUITE} > Reports accepts café and ñandú`]: [SUITE, 'Reports'],
      [`${SUITE} > Invoice is paid by invoice`]: [SUITE, 'Invoice'],
      [`${SUITE} > Failures fails on purpose`]: [SUITE, 'Failures'],
      [`${SUITE} > Failures throws on purpose`]: [SUITE, 'Failures'],
      [`${SUITE} > Flaky passes on the retry of its hook`]: [SUITE, 'Flaky'],
      // The synthetic hook failure keeps the describe of the test it was running.
      [HOOK_FAILURE]: [SUITE, 'Always'],
      [`${SUITE} > Always never runs`]: [SUITE, 'Always'],
      [`${SUITE} > Always never runs either`]: [SUITE, 'Always'],
    });
  });
});
