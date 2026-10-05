/**
 * The automation keys of the reporter and of `probara import junit` on the output of cypress-junit,
 * over one suite and one project: two `cypress run` invocations of the same spec, the first with
 * `@probara/cypress-reporter` and a fake Probara, the second with `cypress-junit` writing the JUnit
 * the CLI then reads. What a team moving from the import to the reporter must keep is that both
 * paths name the same tests: the same key for every test of the suite.
 *
 * Cypress starts in about ten seconds, so the two runs are made once and every assertion reads
 * them.
 */
import { readdir } from 'node:fs/promises';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JUNIT_REPORTER } from './support/project.js';
import { createWorkspace, probaraEnv, TOKEN, type Workspace } from './support/workspace.js';

const SPEC = 'cypress/e2e/parity.cy.js';
/** Two `cypress run` invocations of one spec, and the CLI over what the second one wrote. */
const TIMEOUT = 300_000;

/** Every automation key Probara received, once each, in the order it was first sent. */
function keysOf(probara: FakeProbara): string[] {
  return [
    ...new Set(
      probara
        .reports()
        .flatMap((report) => report.results)
        .map((result) => result.automationKey ?? ''),
    ),
  ];
}

/** The JUnit files `cypress-junit` wrote in `dir`, in the order it wrote them. */
async function junitFilesOf(dir: string): Promise<string[]> {
  const files = await readdir(dir);
  return files.filter((file) => /^junit-[\da-f]+\.xml$/.test(file));
}

describe('the keys of the reporter and of probara import junit on cypress-junit', () => {
  let reported: FakeProbara;
  let imported: FakeProbara;
  let workspace: Workspace;
  let junitFiles: string[] = [];
  const minutes: string[] = [];

  beforeAll(async () => {
    reported = await startFakeProbara({ token: TOKEN });
    imported = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace('parity', { broken: false });

    // The first path: the reporter, in the project a user lays out, reporting to its own fake.
    let started = Date.now();
    const reportedRun = await workspace.cypress(
      ['--browser', 'electron', '--spec', SPEC],
      probaraEnv(reported.baseUrl),
    );
    minutes.push(`reporter ${((Date.now() - started) / 1000).toFixed(1)}s`);
    expect(reportedRun.exitCode).toBe(1);

    // The second path: the same spec with `cypress-junit`, which writes the JUnit instead.
    started = Date.now();
    const junitRun = await workspace.cypress(
      ['--browser', 'electron', '--spec', SPEC],
      probaraEnv(imported.baseUrl, { [JUNIT_REPORTER]: '1' }),
    );
    // One spec, one of its tests failing on purpose: both paths run the same suite, whatever the
    // exit code Cypress ends with.
    expect(junitRun.exitCode).toBe(1);
    minutes.push(`cypress-junit ${((Date.now() - started) / 1000).toFixed(1)}s`);
    junitFiles = await junitFilesOf(workspace.dir);
    expect(junitFiles).toHaveLength(1);

    // And `probara import junit` reads it, into the second fake.
    started = Date.now();
    const importRun = await workspace.probara(
      ['import', 'junit', ...junitFiles],
      probaraEnv(imported.baseUrl),
    );
    minutes.push(`import ${((Date.now() - started) / 1000).toFixed(1)}s`);
    expect(importRun.exitCode).toBe(0);
    expect(`${importRun.stdout}${importRun.stderr}`).not.toContain(TOKEN);
  }, TIMEOUT);

  afterAll(async () => {
    await Promise.all([reported.close(), imported.close()]);
    await workspace.remove();
  });

  it('names every test of the suite the same way through both paths', () => {
    const byReporter = keysOf(reported);
    const byImport = keysOf(imported);
    process.stdout.write(`reporter ${minutes.join(', ')}\n`);
    process.stdout.write(`keys of the reporter: ${JSON.stringify(byReporter, null, 2)}\n`);
    process.stdout.write(`keys of the import: ${JSON.stringify(byImport, null, 2)}\n`);
    // Both sides named a test: an empty set would otherwise equal the other empty set.
    expect(byReporter).toHaveLength(2);
    expect(byImport).toHaveLength(2);
    expect(byImport).toEqual(byReporter);
  });
});
