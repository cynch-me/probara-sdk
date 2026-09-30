/**
 * `runCasesOnly` in the real `jest`, in each supported version, against a fake Probara with a
 * seeded run: only the tests of the run's cases run (by automation key, by a case id in a title or
 * a describe; `test.each` rows, `test.concurrent` tests and `$` patterns included), proven by what
 * the test bodies wrote, and only they are reported. When the selection cannot be made (the cases
 * cannot be read, no setup file, no run), every test runs and is reported, with one warning.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkspace,
  JEST_VERSIONS,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 240_000;
/** A run the fake does not know: reading its cases answers 404. */
const UNKNOWN_RUN = '01K5ZR00000000000000000RN7';

/** The cases of the seeded run. */
const CASES = [
  { caseDisplayId: 'SHOP-1', automationKey: 'tests/cart.test.js > cart adds an item' },
  { caseDisplayId: 'SHOP-2', automationKey: 'tests/cart.test.js > cart pays with visa' },
  { caseDisplayId: 'SHOP-3', automationKey: 'tests/cart.test.js > cart costs {title} more' },
  { caseDisplayId: 'SHOP-5', automationKey: 'tests/cart.test.js > cart removes an item' },
  { caseDisplayId: 'SHOP-9', automationKey: null },
  { caseDisplayId: 'SHOP-11', automationKey: null },
  { caseDisplayId: 'SHOP-20', automationKey: 'tests/gone.test.js > gone' },
];

/** Every test body of the fixture. */
const EVERY_BODY = [
  'cart adds an item',
  'cart checks the stock',
  'cart costs more',
  'cart empties the cart',
  'cart pays with amex',
  'cart pays with visa',
  'cart removes an item',
  'checkout pays',
  'checkout sends the receipt',
  'search finds an item',
  'search finds nothing',
];

/** Every test of the fixture as the reporter sends it, key and status. */
const EVERY_TEST = [
  'tests/cart.test.js > cart adds an item passed',
  'tests/cart.test.js > cart checks the stock passed',
  'tests/cart.test.js > cart costs {title} more passed',
  'tests/cart.test.js > cart empties the cart passed',
  'tests/cart.test.js > cart pays with amex passed',
  'tests/cart.test.js > cart pays with visa passed',
  'tests/cart.test.js > cart removes an item passed',
  'tests/cart.test.js > cart saves it for later skipped',
  'tests/cart.test.js > checkout pays passed',
  'tests/cart.test.js > checkout sends the receipt passed',
  'tests/search.test.js > search finds an item passed',
  'tests/search.test.js > search finds nothing passed',
  'tests/wishlist.test.js > wishlist lists the items skipped',
  'tests/wishlist.test.js > wishlist shares the list skipped',
];

const SELECTED_TESTS = [
  'tests/cart.test.js > cart adds an item passed',
  'tests/cart.test.js > cart costs {title} more passed',
  'tests/cart.test.js > cart pays with visa passed',
  'tests/cart.test.js > cart removes an item passed',
  'tests/cart.test.js > checkout pays passed',
  'tests/cart.test.js > checkout sends the receipt passed',
  // A case of the run, skipped by the test file itself.
  'tests/wishlist.test.js > wishlist lists the items skipped',
];

const SELECTED_BODIES = [
  'cart adds an item',
  'cart costs more',
  'cart pays with visa',
  'cart removes an item',
  'checkout pays',
  'checkout sends the receipt',
];

type Scenario = 'unselected' | 'workers' | 'inBand' | 'unreadable' | 'noSetup' | 'noRun';

/** The results the fake received, as `<key> <status>`, sorted. */
function sent(fake: FakeProbara): string[] {
  return fake
    .reports()
    .flatMap((report) => report.results)
    .map((entry) => `${entry.automationKey ?? ''} ${entry.status}`)
    .sort();
}

/** The `[probara]` lines of a run. */
function probaraLines(run: CommandRun): string[] {
  return run.stderr.split('\n').filter((line) => line.startsWith('[probara]'));
}

/** The `Tests:` line of Jest's summary. */
function testsLine(run: CommandRun): string | undefined {
  return /^Tests: .*$/m.exec(run.stderr)?.[0];
}

describe.each(JEST_VERSIONS)('runCasesOnly in $name', (jest) => {
  let workspace: Workspace;
  const fakes = {} as Record<Scenario, FakeProbara>;
  const runs = {} as Record<Scenario, CommandRun>;
  const bodies = {} as Record<Scenario, string[]>;
  const seeded = {} as Record<Scenario, string>;

  /** Runs `jest <args>` against a fresh fake with the seeded run; what the test bodies ran. */
  async function run(
    scenario: Scenario,
    args: string[],
    env: (run: string) => Record<string, string>,
  ): Promise<void> {
    const fake = await startFakeProbara({ token: TOKEN });
    fakes[scenario] = fake;
    seeded[scenario] = fake.seedRun({ projectId: 'SHOP', cases: CASES });
    const ranFile = join(workspace.dir, `ran-${scenario}.txt`);
    runs[scenario] = await workspace.jest(args, {
      ...probaraEnv(fake.baseUrl),
      RAN_FILE: ranFile,
      ...env(seeded[scenario]),
    });
    const text = await readFile(ranFile, 'utf8').catch(() => '');
    bodies[scenario] = text
      .split('\n')
      .filter((line) => line !== '')
      .sort();
  }

  beforeAll(async () => {
    workspace = await createWorkspace(jest, 'selection');
    await run('unselected', ['--config', 'plain.config.js'], () => ({}));
    await run('workers', ['--maxWorkers=2'], (ulid) => ({ PROBARA_RUN_ULID: ulid }));
    await run('inBand', ['--config', 'plain.config.js', '--runInBand'], (ulid) => ({
      PROBARA_RUN_ULID: ulid,
      PROBARA_RUN_CASES_ONLY: 'true',
    }));
    await run('unreadable', [], () => ({ PROBARA_RUN_ULID: UNKNOWN_RUN }));
    await run('noSetup', ['--config', 'no-setup.config.js'], (ulid) => ({
      PROBARA_RUN_ULID: ulid,
    }));
    await run('noRun', [], () => ({}));
  }, TIMEOUT);

  afterAll(async () => {
    await Promise.all(Object.values(fakes).map((fake) => fake.close()));
    await workspace.remove();
  });

  it('keys the tests like the cases of the run, without runCasesOnly', () => {
    expect(runs.unselected.exitCode).toBe(0);
    expect(bodies.unselected).toEqual(EVERY_BODY);
    expect(sent(fakes.unselected)).toEqual(EVERY_TEST);
    expect(fakes.unselected.requestsTo('caseKeys')).toEqual([]);
  });

  describe.each([
    { mode: 'in workers, by the option', scenario: 'workers' as const },
    { mode: 'in band, by PROBARA_RUN_CASES_ONLY', scenario: 'inBand' as const },
  ])('$mode', ({ scenario }) => {
    it('runs only the tests of the cases of the run: the others never start', () => {
      expect(runs[scenario].exitCode).toBe(0);
      expect(bodies[scenario]).toEqual(SELECTED_BODIES);
      expect(testsLine(runs[scenario])).toBe('Tests:       7 skipped, 1 todo, 6 passed, 14 total');
    });

    it('reports only them, into the run, and says how many ran', () => {
      const fake = fakes[scenario];
      expect(sent(fake)).toEqual(SELECTED_TESTS);
      expect(fake.reports().map((report) => report.run)).toEqual([{ ulid: seeded[scenario] }]);
      expect(probaraLines(runs[scenario])).toEqual(
        expect.arrayContaining([
          `[probara] Ran only the tests of run ${seeded[scenario]}: 7 of 14 tests match its cases; 7 skipped and not reported`,
          '[probara] Sending 7 results of 7 tests (6 passed, 0 failed, 1 skipped, 0 blocked)',
        ]),
      );
      expect(probaraLines(runs[scenario]).filter((line) => line.includes('warn'))).toEqual([]);
      expect(runs[scenario].stdout + runs[scenario].stderr).not.toContain(TOKEN);
    });
  });

  it('runs and reports every test, with one warning, when the cases cannot be read', () => {
    expect(bodies.unreadable).toEqual(EVERY_BODY);
    expect(sent(fakes.unreadable)).toEqual(EVERY_TEST);
    const warnings = probaraLines(runs.unreadable).filter((line) => line.includes('runCasesOnly'));
    expect(warnings).toEqual([
      expect.stringMatching(
        new RegExp(
          `^\\[probara\\] runCasesOnly: could not read the cases of the run ${UNKNOWN_RUN} \\(.+\\)\\. Every test runs and is reported$`,
        ),
      ),
    ]);
  });

  it('runs and reports every test, with one warning, without the setup file', () => {
    expect(bodies.noSetup).toEqual(EVERY_BODY);
    expect(sent(fakes.noSetup)).toEqual(EVERY_TEST);
    expect(probaraLines(runs.noSetup).filter((line) => line.includes('runCasesOnly'))).toEqual([
      expect.stringContaining(
        "[probara] runCasesOnly needs the setup file: add setupFilesAfterEnv: ['@probara/jest-reporter/setup'] to the Jest config. Every test of a file without it runs and is reported (first seen in tests/",
      ),
    ]);
  });

  it('runs and reports every test, with one warning, without the run to select from', () => {
    expect(bodies.noRun).toEqual(EVERY_BODY);
    expect(fakes.noRun.requestsTo('caseKeys')).toEqual([]);
    expect(sent(fakes.noRun)).toEqual(EVERY_TEST);
    expect(probaraLines(runs.noRun).filter((line) => line.includes('runCasesOnly'))).toEqual([
      '[probara] runCasesOnly needs the run whose tests to run: set run.ulid or PROBARA_RUN_ULID. Every test runs and is reported',
    ]);
  });
});
