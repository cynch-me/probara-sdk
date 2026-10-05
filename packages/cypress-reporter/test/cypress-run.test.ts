/**
 * The reporter in a real `cypress run`: the Cypress project of a user, the built reporter by its
 * package name and a fake Probara. Every behavior is what a run reports and logs: one result per
 * attempt with its own key and status, the screenshots and the video of a spec, the run it creates
 * and closes, the results file a refused run leaves, and the warnings of a run that is missing
 * something.
 *
 * Cypress starts in about eight seconds, so the specs are grouped: the whole run in one, and one
 * spec where a setting needs its own run.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReportRequest } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureCypressBinary } from './support/cypress-binary.js';
import {
  KEY_WITHOUT_FILE,
  NO_BROWSER,
  RETRIES,
  STATUS,
  UNKNOWN_OPTION,
  VIDEOS,
  WRAPPED,
} from './support/project.js';
import {
  createWorkspace,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

/** Cypress starts in seconds and a run of four specs takes longer than one: minutes, not seconds. */
const TIMEOUT = 300_000;

/** A real `cypress run` needs the binary, and a machine without one says so once, here. */
beforeAll(() => ensureCypressBinary());
/** The whole run of the reporter: the specs whose behavior is asserted one by one. */
const ALL_SPECS = 'cypress/e2e/{cart,retry,hooks,broken,throws}.cy.js';
const ONE_SPEC = 'cypress/e2e/login.cy.js';
const CART_SPEC = 'cypress/e2e/cart.cy.js';
const HOOKS = 'cypress/e2e/hooks.cy.js';
const THROWS = 'cypress/e2e/throws.cy.js';
const BROKEN = 'cypress/e2e/broken.cy.js';

/**
 * The tests this run leaves failing, which is what Cypress ends a run with: a test whose last
 * attempt failed, be the failure the test's own, a hook's, or the spec's. Read the list, not the
 * number: this fixture fails four of these tests, and it also fails four specs, which is a
 * coincidence of the fixture and not a rule (a spec may fail with several tests, or with none of
 * its own).
 */
const FAILED_TESTS = [
  `${CART_SPEC} > Cart fails on purpose`,
  `${HOOKS} > Checkout never runs`,
  `${BROKEN} > Spec failed to run`,
  `${THROWS} > An uncaught error was detected outside of a test`,
];
/**
 * What the reporter sends for them, in the order it sent it: the four tests of `FAILED_TESTS`, and
 * between them the always failing hook of `hooks.cy.js` under the name Cypress gives such a
 * failure (`"before each" hook for "…"`). It is the same test as `Checkout never runs` — the
 * attempt Cypress retried and the attempt that failed for good — so five failing keys stand for
 * four failing tests, and Cypress ends the run with the four.
 */
const FAILED_KEYS = [
  `${CART_SPEC} > Cart fails on purpose`,
  `${HOOKS} > Checkout never runs`,
  `${HOOKS} > Checkout "before each" hook for "never runs"`,
  `${BROKEN} > Spec failed to run`,
  `${THROWS} > An uncaught error was detected outside of a test`,
];

type Status = 'passed' | 'failed' | 'skipped' | 'blocked';

/** `<automation key> | <case display id or ->` → the status of each attempt, in the order sent. */
export type Entries = Record<string, Status[]>;

/** The entries of every report, grouped by key and case, attempts in the order they were sent. */
function entriesOf(fake: FakeProbara): Entries {
  const entries: Entries = {};
  for (const result of resultsOf(fake)) {
    const label = `${result.automationKey ?? '?'} | ${result.caseDisplayId ?? '-'}`;
    (entries[label] ??= []).push(result.status);
  }
  return entries;
}

/** Every result Probara received, in the order it was sent. */
function resultsOf(probara: FakeProbara): ReportRequest['results'] {
  return probara.reports().flatMap((report) => report.results);
}

/** The keys whose last attempt failed, in the order they were sent: the tests a run ends with. */
function failedTestsOf(probara: FakeProbara): string[] {
  const last = new Map<string, string>();
  for (const result of resultsOf(probara)) last.set(result.automationKey ?? '', result.status);
  return [...last].filter(([, status]) => status === 'failed').map(([key]) => key);
}

/** The `[probara]` lines of a run, without the ones core logs at debug. */
function probaraLines(run: CommandRun): string[] {
  return `${run.stdout}${run.stderr}`
    .split('\n')
    .filter((line) => line.includes('[probara]'))
    .map((line) => line.trim());
}

/** A fake Probara, its workspace and the runs of `cypress run` against it. */
interface Run {
  fake: FakeProbara;
  workspace: Workspace;
  run: CommandRun;
}

describe('a real cypress run with the reporter and its plugin', () => {
  let all: Run;

  beforeAll(async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const workspace = await createWorkspace();
    const run = await workspace.cypress(
      ['--browser', 'electron', '--spec', ALL_SPECS],
      probaraEnv(fake.baseUrl),
    );
    all = { fake, workspace, run };
  }, TIMEOUT);

  afterAll(async () => {
    await all.fake.close();
    await all.workspace.remove();
  });

  it('keeps the exit code of the tests, logs on stderr only, and never the token', () => {
    // Cypress ends a `cypress run` with the number of failed TESTS, not of failed specs
    // (measured on 16.1.1), and reporting changes nothing of it. Never trust a bare number here:
    // this fixture fails the four tests of `FAILED_TESTS` and, by accident, four specs as well,
    // and the reporter sends five failed keys for them (see `FAILED_KEYS`).
    expect(failedTestsOf(all.fake)).toEqual(FAILED_KEYS);
    expect(all.run.exitCode).toBe(FAILED_TESTS.length);
    expect(all.run.stdout).not.toContain('[probara]');
    expect(`${all.run.stdout}${all.run.stderr}`).not.toContain(TOKEN);
  });

  it('sends every test of every spec into one run, with its status and its case ids', () => {
    // The key holds no case id: the ids of a title link the test to its cases, they do not name it.
    expect(entriesOf(all.fake)).toEqual({
      'cypress/e2e/cart.cy.js > Cart adds an item | -': ['passed'],
      // The spec runs with `retries.runMode: 1`: this test never passes, so both of its attempts
      // are results, the failed first attempt (the `retry` event) and the second one.
      'cypress/e2e/cart.cy.js > Cart fails on purpose | SHOP-12': ['failed', 'failed'],
      'cypress/e2e/cart.cy.js > Cart is skipped | -': ['skipped'],
      'cypress/e2e/cart.cy.js > Checkout WEB-3 keeps another project id in its title | SHOP-7': [
        'passed',
      ],
      'cypress/e2e/cart.cy.js > Checkout pays by card | SHOP-7': ['passed'],
      // Every attempt of a retried test is a result of its own, the failed one first.
      'cypress/e2e/retry.cy.js > Flaky passes on its retry | -': ['failed', 'passed'],
      'cypress/e2e/retry.cy.js > Flaky passes first time | -': ['passed'],
      'cypress/e2e/hooks.cy.js > Cart passes on the retry of its hook | -': ['failed', 'passed'],
      // A hook that fails on every attempt is reported as the synthetic test Cypress names, and
      // the tests after it never ran: they are skipped.
      'cypress/e2e/hooks.cy.js > Checkout never runs | -': ['failed'],
      'cypress/e2e/hooks.cy.js > Checkout "before each" hook for "never runs" | -': ['failed'],
      'cypress/e2e/hooks.cy.js > Checkout never runs either | -': ['skipped'],
      'cypress/e2e/hooks.cy.js > Profile still runs | -': ['passed'],
      // A spec that throws while it loads still builds a reporter, and Cypress names the failure
      // after what happened: it is the one failed result of that spec (retried once, like any).
      'cypress/e2e/throws.cy.js > An uncaught error was detected outside of a test | -': [
        'failed',
        'failed',
      ],
      // A spec that cannot be parsed builds no reporter at all: one failed result of its own, so
      // it never shows green.
      'cypress/e2e/broken.cy.js > Spec failed to run | -': ['failed'],
    });
    // Every spec went into the same run, which is closed at the end of the run.
    expect(all.fake.runs().map((created) => [created.name, created.state])).toEqual([
      ['Cypress run', 'closed'],
    ]);
  });

  it('logs what it sends, once, with the statuses core sends', () => {
    const results = resultsOf(all.fake);
    const line = probaraLines(all.run).find((each) => each.includes('Sending '));
    expect(line).toBe(
      `[probara] Sending ${String(results.length)} results of 14 tests (7 passed, 9 failed, 2 skipped, 0 blocked)`,
    );
    expect(probaraLines(all.run)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          new RegExp(
            `^\\[probara\\] Recorded ${String(results.length)} results .* in R-1 \\(closed\\)`,
          ),
        ),
        expect.stringMatching(/^\[probara\] Attached 8 files to results \(0 skipped, 0 failed\)$/),
      ]),
    );
  });

  it('attaches the screenshot of each failed attempt to that attempt, and no video', () => {
    const staged = all.fake.stagedFiles();
    // One per failed attempt: two in `cart` (the test never passes, so it is retried once), one in
    // `retry`, and two in `hooks` (the retried one, and the one the always-failing hook took).
    expect(staged.map((file) => file.name).sort()).toEqual(
      [
        'Cart -- SHOP-12 fails on purpose (failed).png',
        'Cart -- SHOP-12 fails on purpose (failed) (attempt 2).png',
        'Cart -- passes on the retry of its hook (failed).png',
        'Checkout -- never runs (failed).png',
        'Checkout -- never runs -- before each hook (failed) (attempt 2).png',
        'Flaky -- passes on its retry (failed).png',
        // The spec that throws while it loads fails outside any test, and Cypress names it that way.
        'An uncaught error was detected outside of a test (failed).png',
        'An uncaught error was detected outside of a test (failed) (attempt 2).png',
      ].sort(),
    );
    expect(staged.every((file) => file.type === 'image/png')).toBe(true);
  });

  it('sends the browser it runs as a parameter of every result, never in the key', () => {
    const [first] = resultsOf(all.fake);
    expect(first?.parameters).toEqual({ browser: 'electron' });
    expect(first?.automationKey).toBe('cypress/e2e/cart.cy.js > Cart adds an item');
  });

  it('writes the error of a failed attempt into the notes, without terminal colors', () => {
    const notes = (title: string) =>
      resultsOf(all.fake)
        .filter((result) => result.automationKey?.endsWith(title) === true)
        .map((result) => result.notes);
    expect(notes('fails on purpose')).toEqual([
      expect.stringContaining('expected'),
      expect.stringContaining('expected'),
    ]);
    // A hook that failed says so, as Cypress wrote it.
    expect(notes('"before each" hook for "never runs"')[0]).toContain('before each');
    expect(notes('Cart adds an item')).toEqual([undefined]);
    expect(resultsOf(all.fake).some((result) => result.notes?.includes('\u001b') === true)).toBe(
      false,
    );
  });

  it('sends when each attempt started, in the order the run ran them', () => {
    const executed = resultsOf(all.fake).map((result) => Date.parse(result.executedAt ?? ''));
    expect(executed.every((at) => Number.isFinite(at))).toBe(true);
    // Each attempt of a retried test from its own start, in the order they were sent.
    const [first, retry] = resultsOf(all.fake)
      .filter((result) => result.automationKey?.endsWith('passes on its retry') === true)
      .map((result) => Date.parse(result.executedAt ?? ''));
    expect(retry).toBeGreaterThan(first ?? Infinity);
  });

  it('says nothing about what it left out, and warns about nothing', () => {
    const lines = probaraLines(all.run);
    expect(lines.filter((line) => line.includes('Left out'))).toEqual([]);
    expect(lines.filter((line) => line.includes('WARN') || line.includes('Warning'))).toEqual([]);
    expect(lines.filter((line) => line.startsWith('[probara] Ignored'))).toEqual([]);
  });
});

describe('a run of one spec, with settings that need a run of their own', () => {
  let filtered: Run;
  let mapped: Run;

  beforeAll(async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const workspace = await createWorkspace('project', { broken: false });
    const run = await workspace.cypress(
      ['--browser', 'electron', '--spec', ONE_SPEC],
      probaraEnv(fake.baseUrl, { [KEY_WITHOUT_FILE]: 'no-file' }),
    );
    filtered = { fake, workspace, run };

    const mappedFake = await startFakeProbara({ token: TOKEN });
    const mappedWorkspace = await createWorkspace('project', { broken: false });
    const mappedRun = await mappedWorkspace.cypress(
      ['--browser', 'electron', '--spec', CART_SPEC],
      probaraEnv(mappedFake.baseUrl, { [VIDEOS]: '1', [STATUS]: 'map', [RETRIES]: '0' }),
    );
    mapped = { fake: mappedFake, workspace: mappedWorkspace, run: mappedRun };
  }, TIMEOUT);

  afterAll(async () => {
    await Promise.all(
      [filtered, mapped].map(async (each) => {
        await each.fake.close();
        await each.workspace.remove();
      }),
    );
  });

  it('reports the spec it was asked for, and nothing of the specs it was not', () => {
    // `keyIncludesFile: false`: the keys of a JUnit report written without the file attribute.
    expect(entriesOf(filtered.fake)).toEqual({
      'Login is only reported when it is asked for | -': ['passed'],
    });
    const reported = resultsOf(filtered.fake);
    expect(reported.every((result) => !result.automationKey?.includes('cypress/e2e/'))).toBe(true);
    expect(`${filtered.run.stdout}${filtered.run.stderr}`).not.toContain('checkout.cy.js');
  });

  it('maps the statuses the options say', () => {
    const statuses = new Set(resultsOf(mapped.fake).map((result) => result.status));
    expect(statuses.has('failed')).toBe(false);
    expect(statuses.has('blocked')).toBe(true);
    // Core logs the statuses it sends, with the mapping applied.
    expect(probaraLines(mapped.run).find((line) => line.includes('Sending '))).toContain(
      '0 failed, 1 skipped, 1 blocked)',
    );
  });

  it(
    'leaves the results a statusFilter names out, and says how many',
    async () => {
      const filteredFake = await startFakeProbara({ token: TOKEN });
      const filteredWorkspace = await createWorkspace('project', { broken: false });
      try {
        const runCypress = await filteredWorkspace.cypress(
          ['--browser', 'electron', '--spec', CART_SPEC],
          probaraEnv(filteredFake.baseUrl, { [STATUS]: 'filter', [RETRIES]: '0' }),
        );
        expect(runCypress.exitCode).toBe(1);
        // Every failure of the spec is left out; the passed and the skipped one are sent.
        expect(entriesOf(filteredFake)).toEqual({
          [`${CART_SPEC} > Cart adds an item | -`]: ['passed'],
          [`${CART_SPEC} > Cart is skipped | -`]: ['skipped'],
          [`${CART_SPEC} > Checkout WEB-3 keeps another project id in its title | SHOP-7`]: [
            'passed',
          ],
          [`${CART_SPEC} > Checkout pays by card | SHOP-7`]: ['passed'],
        });
        expect(probaraLines(runCypress).find((line) => line.includes('Sending '))).toContain(
          '1 left out by statusFilter',
        );
      } finally {
        await filteredFake.close();
        await filteredWorkspace.remove();
      }
    },
    TIMEOUT,
  );

  it('attaches the video of the spec to every failed result of it', () => {
    const videos = mapped.fake.stagedFiles().filter((file) => file.type === 'video/mp4');
    // The video of the spec, once per failed result of it (one failure, `retries: 0`).
    expect(videos.map((file) => file.name)).toEqual(['cart.cy.js.mp4']);
  });

  it(
    'sends no browser parameter with browserAsParameter false',
    async () => {
      const fake = await startFakeProbara({ token: TOKEN });
      const workspace = await createWorkspace('project', { broken: false });
      try {
        const run = await workspace.cypress(
          ['--browser', 'electron', '--spec', ONE_SPEC],
          probaraEnv(fake.baseUrl, { [NO_BROWSER]: '1' }),
        );
        expect(run.exitCode).toBe(0);
        expect(resultsOf(fake)[0]?.parameters).toBeUndefined();
      } finally {
        await fake.close();
        await workspace.remove();
      }
    },
    TIMEOUT,
  );
});

describe('a run whose reporter options arrive wrapped, as a multi-reporter passes them', () => {
  let run: Run;

  beforeAll(async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const workspace = await createWorkspace('project', { broken: false });
    const runCypress = await workspace.cypress(
      ['--browser', 'electron', '--spec', ONE_SPEC],
      probaraEnv(fake.baseUrl, { [WRAPPED]: '1' }),
    );
    run = { fake, workspace, run: runCypress };
  }, TIMEOUT);

  afterAll(async () => {
    await run.fake.close();
    await run.workspace.remove();
  });

  it('reads the same options in both processes, and reports the spec in one closed run', () => {
    // The config hands `reporterOptions: { '@probara/cypress-reporter': { … } }` to both processes:
    // the reporter builds each Mocha reporter, the plugin owns the run. The wrapper is unwrapped
    // by both (`reporter-options.ts`), so the run the plugin created is the run the results went
    // into; reading it raw in one of them would report nothing here and warn about an unknown
    // option nobody passed.
    expect(run.run.exitCode).toBe(0);
    expect(entriesOf(run.fake)).toEqual({
      'cypress/e2e/login.cy.js > Login is only reported when it is asked for | -': ['passed'],
    });
    expect(run.fake.runs().map((created) => [created.name, created.state])).toEqual([
      ['Cypress run', 'closed'],
    ]);
    expect(probaraLines(run.run).filter((line) => line.includes('unknown option'))).toEqual([]);
  });
});

describe('a run whose reporting cannot reach Probara', () => {
  let run: Run;

  beforeAll(async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    fake.fail('report', { status: 403 });
    const workspace = await createWorkspace('project', { broken: false });
    const runCypress = await workspace.cypress(
      ['--browser', 'electron', '--spec', ONE_SPEC],
      probaraEnv(fake.baseUrl, {
        [KEY_WITHOUT_FILE]: 'no-file',
        PROBARA_RESULTS_FILE: 'results/probara-results.json',
      }),
    );
    run = { fake, workspace, run: runCypress };
  }, TIMEOUT);

  afterAll(async () => {
    await run.fake.close();
    await run.workspace.remove();
  });

  it('keeps what it could not send in a results file, and the token out of it', async () => {
    // What core logs when it could not send them: the line that names the file, and the summary.
    expect(probaraLines(run.run).filter((line) => line.includes('not sent'))).toEqual([
      expect.stringContaining('1 result was not sent: Probara answered 403'),
      expect.stringContaining('Wrote the 1 result that was not sent to'),
    ]);
    const file = JSON.parse(
      await readFile(join(run.workspace.dir, 'results', 'probara-results.json'), 'utf8'),
    ) as { version: number; results: { identity: { titlePath: string[] }; status: string }[] };
    expect(file.version).toBe(1);
    // What it keeps is the result the reporter built, to be imported like any other.
    expect(file.results).toEqual([
      expect.objectContaining({
        identity: { titlePath: ['Login is only reported when it is asked for'] },
        status: 'passed',
      }),
    ]);
    expect(JSON.stringify(file)).not.toContain(TOKEN);
  });

  it('sends the results file later with `probara import results`, like the run would have', async () => {
    const later = await startFakeProbara({ token: TOKEN });
    try {
      const imported = await run.workspace.probara(
        ['import', 'results', 'results/probara-results.json'],
        probaraEnv(later.baseUrl),
      );
      expect(imported.exitCode).toBe(0);
      expect(`${imported.stdout}${imported.stderr}`).not.toContain(TOKEN);
      // The same entries a run that could send them sends (the run of one spec above).
      expect(entriesOf(later)).toEqual({
        'Login is only reported when it is asked for | -': ['passed'],
      });
      expect(later.runs().map((created) => created.state)).toEqual(['closed']);
    } finally {
      await later.close();
    }
  });
});

describe('a run whose Cypress config registers no plugin', () => {
  let run: Run;

  beforeAll(async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    const workspace = await createWorkspace('no-plugin', { broken: false });
    const runCypress = await workspace.cypress(
      ['--browser', 'electron', '--spec', ONE_SPEC],
      probaraEnv(fake.baseUrl),
    );
    run = { fake, workspace, run: runCypress };
  }, TIMEOUT);

  afterAll(async () => {
    await run.fake.close();
    await run.workspace.remove();
  });

  it('still sends every result, in a run of its own, and never crashes', () => {
    expect(run.run.exitCode).toBe(0);
    expect(entriesOf(run.fake)).toEqual({
      'cypress/e2e/login.cy.js > Login is only reported when it is asked for | -': ['passed'],
    });
    expect(run.fake.runs().map((created) => created.state)).toEqual(['closed']);
    expect(`${run.run.stdout}${run.run.stderr}`).not.toContain(TOKEN);
    // The warning that names what is missing is logged by the reporter process, and Cypress keeps
    // that process' output to itself (neither its stdout nor its stderr reaches the console), so
    // what this run shows of itself is the run it had to make of its own: `reporter.test.ts` covers
    // the warning itself.
  });

  it(
    'warns about an option it does not know, and reports all the same',
    async () => {
      const fake = await startFakeProbara({ token: TOKEN });
      const workspace = await createWorkspace('project', { broken: false });
      try {
        const runCypress = await workspace.cypress(
          ['--browser', 'electron', '--spec', ONE_SPEC],
          probaraEnv(fake.baseUrl, { [UNKNOWN_OPTION]: '1' }),
        );
        expect(runCypress.exitCode).toBe(0);
        expect(probaraLines(runCypress).filter((line) => line.includes('unknown option'))).toEqual([
          '[probara] Ignored the unknown option "notAnOption" of @probara/cypress-reporter',
        ]);
        expect(resultsOf(fake)).toHaveLength(1);
      } finally {
        await fake.close();
        await workspace.remove();
      }
    },
    TIMEOUT,
  );
});
