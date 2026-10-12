/**
 * The keys of the reporter and of `probara import junit` on the output of Vitest's own `junit`
 * reporter, over one suite (`test/fixtures/parity`), on every major. The reporter runs twice (with
 * the file in the key, and without it: `keyIncludesFile`). Vitest's JUnit output is written twice
 * (the default, and with the file on every testcase: `addFileAttribute`), and the CLI imports each
 * JUnit file into a fake of its own. Both paths name every test the same: the file, the describes,
 * the title and the case it links. The suite and its expectations are in `test/support/expected.ts`.
 */
import { buildWhenStale, CLI_BUILD } from '@probara/test-support/build';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EARLIER_ATTEMPTS,
  earlierAttemptsOf,
  entriesOf,
  expectedEntries,
  labelsOf,
  lastStatusesOf,
  sentEntries,
  SUITE,
  type Entries,
} from './support/expected.js';
import { buildReporter } from './support/reporter-build.js';
import {
  createWorkspace,
  probaraEnv,
  TOKEN,
  VITEST_VERSIONS,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 300_000;
/** Vitest's own JUnit output, as its default `junit` reporter writes it. */
const JUNIT = 'reports/junit.xml';
/** The same output with `addFileAttribute`: `junit-file.config.mts` of the fixture writes it. */
const JUNIT_FILE = 'reports/junit-file.xml';

/** A run that sent to a fake Probara: the fake, and the command's run. */
interface Sent {
  probara: FakeProbara;
  run: CommandRun;
}

/** Every result a fake Probara received, grouped by key and case, as `entriesOf` groups them. */
function entriesOfFake(probara: FakeProbara): Entries {
  return entriesOf(probara.reports());
}

describe.each(VITEST_VERSIONS)(
  '$name: the keys of the reporter and of probara import junit',
  (vitest) => {
    const fakes: FakeProbara[] = [];
    let workspace: Workspace | undefined;
    let reporter: Sent;
    let reporterWithoutFile: Sent;
    let importer: Sent;
    let importerWithFile: Sent;
    let junitRun: CommandRun;
    let junitWithFileRun: CommandRun;

    beforeAll(async () => {
      await buildReporter();
      await buildWhenStale(CLI_BUILD);
      const dir = await createWorkspace(vitest, 'parity');
      workspace = dir;
      /** Runs `command` with a job's Probara environment, reporting to a fake of its own. */
      const sending = async (
        command: (env: Record<string, string>) => Promise<CommandRun>,
        extra: Record<string, string> = {},
      ): Promise<Sent> => {
        const probara = await startFakeProbara({ token: TOKEN });
        fakes.push(probara);
        return { probara, run: await command(probaraEnv(probara.baseUrl, extra)) };
      };

      reporter = await sending((env) => dir.vitest(['run'], env));
      reporterWithoutFile = await sending((env) => dir.vitest(['run'], env), {
        PROBARA_KEY_INCLUDES_FILE: 'false',
      });
      junitRun = await dir.vitest(['run', '--reporter=junit', `--outputFile=${JUNIT}`]);
      junitWithFileRun = await dir.vitest(['run', '--config', 'junit-file.config.mts']);
      importer = await sending((env) => dir.probara(['import', 'junit', JUNIT], env));
      importerWithFile = await sending((env) => dir.probara(['import', 'junit', JUNIT_FILE], env));
    }, TIMEOUT);

    afterAll(async () => {
      await Promise.all(fakes.map((fake) => fake.close()));
      await workspace?.remove();
    });

    it('names every test of the suite the same on the reporter and on probara import junit: the file, the describes, the title and the case', () => {
      const byReporter = labelsOf(entriesOfFake(reporter.probara));
      const byImport = labelsOf(entriesOfFake(importer.probara));
      expect(byReporter).toEqual(byImport);
      expect(byImport).toEqual(labelsOf(expectedEntries(true)));
      // The format itself, once: the file, the describes and the title, then the case they link.
      expect(byImport).toContain(
        'tests/suite.test.ts > checkout > accepts café and ñandú | SHOP-12',
      );
    });

    it('names every test the same when Vitest writes the file on every testcase (addFileAttribute)', () => {
      expect(labelsOf(entriesOfFake(importerWithFile.probara))).toEqual(
        labelsOf(entriesOfFake(reporter.probara)),
      );
    });

    it('gives every test the status of its JUnit result, one result per test, and lists the earlier attempts the reporter sends', () => {
      expect(entriesOfFake(importer.probara)).toEqual(expectedEntries(true));
      expect(entriesOfFake(importerWithFile.probara)).toEqual(expectedEntries(true));
      expect(lastStatusesOf(entriesOfFake(reporter.probara))).toEqual(
        lastStatusesOf(entriesOfFake(importer.probara)),
      );
      expect(earlierAttemptsOf(entriesOfFake(reporter.probara))).toEqual(EARLIER_ATTEMPTS);
    });

    it('without the file, names every test as core names its identity with no file, and sends every entry of the run, the earlier attempts included', () => {
      expect(entriesOfFake(reporterWithoutFile.probara)).toEqual(sentEntries(false));
    });

    it('keeps the exit codes of the tests, counts every test it sends, and keeps the token out of every output', () => {
      expect(reporter.run.exitCode).toBe(1);
      expect(reporterWithoutFile.run.exitCode).toBe(1);
      expect(junitRun.exitCode).toBe(1);
      expect(junitWithFileRun.exitCode).toBe(1);
      expect(importer.run.exitCode).toBe(0);
      expect(importerWithFile.run.exitCode).toBe(0);
      expect(importer.run.stderr).toContain(`${JUNIT}: vitest`);
      expect(importerWithFile.run.stderr).toContain(`${JUNIT_FILE}: vitest`);
      const sent = SUITE.length + Object.values(EARLIER_ATTEMPTS).flat().length;
      expect(reporter.run.stderr).toContain(
        `[probara] Sending ${String(sent)} results of ${String(SUITE.length)} tests`,
      );
      for (const { run } of [reporter, reporterWithoutFile, importer, importerWithFile]) {
        expect(run.stdout + run.stderr).not.toContain(TOKEN);
      }
    });
  },
);
