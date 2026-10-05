/**
 * `@probara/cypress-reporter/setup`: the `setupNodeEvents` of the Cypress config. It turns on what
 * only the plugin can do: it owns the Probara run (created, completed and closed where Cypress
 * awaits `after:run`), reads the results the reporter process handed over, attaches the video of
 * each spec to its failed results, registers the `probara` task the `probara.*` helpers of the
 * support file call, and tells the browser what it needs through `config.expose`.
 *
 * Cypress runs this in a **child** process of the one that builds the reporter, so nothing here is
 * module state with the reporter: the two meet in the session directory (`session-files.ts`).
 *
 * Without it the reporter still sends every result, one run per spec, and one warning names what
 * is missing.
 */
import { listRunCaseKeys, redact, type Logger, type RunSelection } from '@probara/core';
import type { ProbaraExpose } from './plugin-message.js';
import { payloadOf } from './browser-message.js';
import { cypressTestIdentity, automationKeyOf } from './identity.js';
import type {
  CypressBeforeRun,
  CypressPluginConfig,
  CypressPluginEvents,
  CypressScreenshotDetails,
  CypressSpecResults,
} from './cypress.js';
import { resolveSetup, type ProbaraCypressOptions, type Setup } from './options.js';
import { probaraOptionsOf } from './reporter-options.js';
import {
  addAttachment,
  addDeselected,
  addLine,
  addScreenshot,
  beginSpec,
  closeRun,
  completeRun,
  endSpec,
  openRun,
  setBrowser,
} from './run.js';
import { VERSION } from './version.js';

/**
 * The types a typed `setupNodeEvents` needs: the `on` it registers on, and the config it is handed
 * (and hands back), with the part of it this package reads.
 */
export type {
  CypressBeforeRun,
  CypressPluginConfig,
  CypressPluginEvents,
  CypressPluginHandler,
  CypressScreenshotDetails,
  CypressSpecResults,
  CypressSpecStats,
} from './cypress.js';
export type { Setup, ProbaraCypressOptions } from './options.js';

/** The warning of `runCasesOnly` without a run to take the tests from. */
const SELECTION_RUN_MISSING =
  'runCasesOnly needs the run whose tests to run: set run.ulid or PROBARA_RUN_ULID. Every test runs and is reported';

/** What each reason the run's cases could not be read says. */
function selectionFailed(run: string, reason: string): string {
  return `runCasesOnly: could not read the cases of the run ${run} (${reason}). Every test runs and is reported`;
}

/** The warning of `runCasesOnly` when nothing ever asked about the selection. */
const SELECTION_NO_SUPPORT =
  "runCasesOnly needs the support file: require('@probara/cypress-reporter/support') in the Cypress support file, or every test runs and is reported";

/** What the `cy.task('probara', …)` of the browser answers to a `select`. */
export interface SelectionAnswer {
  selected: boolean;
}

/**
 * Whether the test of the spec at `file` whose titles are `titlePath` belongs to the run of
 * `selection`: its automation key is one of the run's cases, or its title or a describe names one
 * of them. Decided here, with the reporter's own identity (`identity.ts`), so the browser and the
 * report agree on one implementation; a `probara.id()` counts for nothing (it runs with the test,
 * after this question).
 */
export function selects(
  selection: RunSelection,
  file: string,
  titlePath: readonly string[],
): boolean {
  // The browser sends the describes and the title; the identity of the reporter is one full title,
  // which is what cypress-junit writes as the `name` of a testcase.
  const test = { suiteTitles: [], title: titlePath.join(' ').trim() };
  const context = {
    projectCodes: selection.projectCodes,
    keyIncludesFile: selection.keyIncludesFile,
    rootDir: selection.rootDir,
  };
  if (cypressTestIdentity(file, test, context).ids.some((id) => selection.caseIds.includes(id)))
    return true;
  const key = automationKeyOf(file, test, context);
  return key !== undefined && selection.keys.includes(key);
}

/**
 * Registers the Node events of a Cypress run. Use it as the whole of `setupNodeEvents`:
 * `setupNodeEvents(on, config) { return probaraNodeEvents(on, config); }`. Returns `config`, with
 * `config.expose.probara` added when anything is reported (so the `probara.*` helpers of the
 * support file stay quiet when it is not). Never throws.
 */
export function probaraNodeEvents(
  on: CypressPluginEvents,
  config: CypressPluginConfig,
): CypressPluginConfig {
  try {
    // The plugin knows what the reporter alone cannot: the project root, and whether the run is
    // interactive. It resolves the options of the run once, for its own work and the reporter's.
    // `config.reporterOptions` is whatever the user wrote; core turns reporting off for what it
    // cannot read, and the reporter resolves the same options in its own process, read the same way
    // (`reporter-options.ts`): a multi-reporter's wrapper is unwrapped by both, or the plugin would
    // own a run it resolved no settings for while the reporter sent everything into it.
    const given = probaraOptionsOf(config.reporterOptions ?? {}) as ProbaraCypressOptions;
    const setup = resolveSetup(given, config.projectRoot);
    const { logger } = setup.core;
    for (const warning of setup.warnings) logger?.warn(warning);
    openRun(setup, config.isInteractive === true);
    let spec = '';
    /** The cases of the run, read once, whatever the number of specs that ask for them. */
    const cases = readOnce(setup, logger);
    /**
     * The answer to `select`: whether the cases of the run take the test that asked. A promise the
     * first time, because a test can ask before `before:spec` resolved them (Cypress awaits what a
     * task returns); without the cases every test is in the run.
     */
    const selectTest = async ({ file, titlePath }: { file: string; titlePath: string[] }) => {
      chosen ??= await cases;
      if (chosen === undefined) return { selected: true } satisfies SelectionAnswer;
      const selected = selects(chosen, file, titlePath);
      if (!selected) {
        asked = true;
        addDeselected(file, chosen.run, titlePath);
      }
      return { selected } satisfies SelectionAnswer;
    };
    /** What the cases resolved to; `undefined` when they could not be read. */
    let chosen: RunSelection | undefined;
    let asked = false;

    on('before:run', (details: CypressBeforeRun) => {
      setBrowser(details.browser?.name);
    });

    on('before:spec', async (given_: { relative: string }) => {
      spec = given_.relative;
      beginSpec(spec);
      // Read once, however many specs the run has: every spec reads what the first one read.
      chosen = await cases;
    });

    on('after:screenshot', (details: CypressScreenshotDetails) => {
      addScreenshot(spec, details.path);
    });

    on('after:spec', (given_: { relative: string }, results: CypressSpecResults) => {
      endSpec(given_.relative, videoOf(results), results.stats?.failures ?? 0);
    });

    // Awaited by Cypress before it ends the run: everything the reporter handed over is sent, and
    // the run this created is closed, whatever the exit code of the tests was. A plugin always owns
    // a run when it gets here (its logger is resolved by core, `openRun` therefore opens the run,
    // and it opens it before this event is registered), so there is nothing about a missing reporter
    // to report: a config that registers none has no plugin, and this line never runs.
    on('after:run', async () => {
      // The support file asked about the selection in no spec of the run: every test ran and is
      // reported, and this says what would have made the selection work.
      if (chosen !== undefined && !asked) logger?.warn(SELECTION_NO_SUPPORT);
      // The run hands its own lines over before this answers: Cypress ends the plugin process (and
      // the pipe its output goes through) the moment it does.
      await completeRun();
      closeRun();
    });

    on('task', {
      probara(payload: unknown) {
        const message = payloadOf(payload);
        if (message === undefined) return null;
        if (message.kind === 'line') {
          addLine(message.line);
          return null;
        }
        if (message.kind === 'attachment') {
          addAttachment(message);
          return null;
        }
        // The run selection: the plugin decides, with the identity the reporter itself uses.
        return selectTest(message);
      },
    });

    expose(config, setup);
    return config;
  } catch {
    // The plugin must never break the run: the reporter reports on its own, and says why.
    return config;
  }
}

/** The video of a spec, or `null` when it has none. */
function videoOf(results: CypressSpecResults): string | null {
  return typeof results.video === 'string' && results.video !== '' ? results.video : null;
}

/**
 * The cases of the run, read once however many specs (or `select` messages) ask for them, and
 * `undefined` without one to ask: every test then runs and is reported.
 */
function readOnce(setup: Setup, logger: Logger | undefined): Promise<RunSelection | undefined> {
  return setup.runCasesOnly ? readSelection(setup, logger) : Promise.resolve(undefined);
}

/**
 * What the browser side of this run needs (`Cypress.expose('probara')`): the version of the
 * package, whether to capture the console, and whether to ask about the run's cases before each
 * test. Left out entirely when nothing is reported, so the helpers stay quiet.
 *
 * Everything it holds has to be known when `setupNodeEvents` returns: Cypress sends the browser
 * what `config.expose` holds at that moment, and what the plugin fills in later (at `before:spec`,
 * where it reads the cases of the run) never reaches a spec (verified in a real Cypress 16.1.1
 * run). The cases themselves are therefore asked for, per test, with a `select` message.
 */
function expose(config: CypressPluginConfig, setup: Setup): void {
  config.expose = config.expose ?? {};
  config.expose.probara = {
    version: VERSION,
    captureOutput: setup.captureOutput,
    runCasesOnly: setup.runCasesOnly,
  } satisfies ProbaraExpose;
}

/**
 * The cases of the run `runCasesOnly` takes the tests from, read once by the plugin, or `undefined`
 * after one warning when they cannot be read: every test then runs and is reported. Never rejects.
 */
async function readSelection(
  setup: Setup,
  logger: Logger | undefined,
): Promise<RunSelection | undefined> {
  const { run, env } = setup.core;
  const ulid = (run?.ulid ?? (env ?? process.env).PROBARA_RUN_ULID ?? '').trim().toUpperCase();
  if (ulid === '') {
    logger?.warn(SELECTION_RUN_MISSING);
    return undefined;
  }
  try {
    const summary = await listRunCaseKeys({ ...setup.core, run: { ulid } });
    if (summary.status !== 'listed') {
      logger?.warn(selectionFailed(ulid, summary.error?.message ?? 'reporting to Probara is off'));
      return undefined;
    }
    return {
      run: ulid,
      keys: summary.cases.flatMap(({ automationKey }) =>
        automationKey === null ? [] : [automationKey],
      ),
      caseIds: summary.cases.map(({ caseDisplayId }) => caseDisplayId),
      projectCodes: setup.projectCodes,
      keyIncludesFile: setup.keyIncludesFile,
      rootDir: setup.core.rootDir ?? process.cwd(),
    };
  } catch (error) {
    // Only a guard: core refuses a malformed run.ulid, and listRunCaseKeys never rejects.
    const { apiToken, env } = setup.core;
    const secrets = [apiToken, (env ?? process.env).PROBARA_API_TOKEN].filter(
      (secret): secret is string => typeof secret === 'string' && secret !== '',
    );
    logger?.warn(
      selectionFailed(
        ulid,
        redact(error instanceof Error ? error.message : String(error), secrets),
      ),
    );
    return undefined;
  }
}
