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
import type {
  CypressBeforeRun,
  CypressPluginConfig,
  CypressPluginEvents,
  CypressScreenshotDetails,
  CypressSpecResults,
} from './cypress.js';
import { resolveSetup, type ProbaraCypressOptions, type Setup } from './options.js';
import {
  addLine,
  addScreenshot,
  beginSpec,
  closeRun,
  completeRun,
  endSpec,
  openRun,
  runLogger,
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

/** The warning of a run whose Cypress config registers no reporter of this package. */
export const REPORTER_MISSING =
  "Nothing was reported: the Cypress config registers no reporter of @probara/cypress-reporter. Set reporter: '@probara/cypress-reporter' with reporterOptions in the Cypress config";

/** The warning of `runCasesOnly` without a run to take the tests from. */
const SELECTION_RUN_MISSING =
  'runCasesOnly needs the run whose tests to run: set run.ulid or PROBARA_RUN_ULID. Every test runs and is reported';

/** What each reason the run's cases could not be read says. */
function selectionFailed(run: string, reason: string): string {
  return `runCasesOnly: could not read the cases of the run ${run} (${reason}). Every test runs and is reported`;
}

/** The lines of the transport a `cy.task('probara', …)` can carry: a helper message, a step, a file. */
const LINE_TYPES = new Set(['message', 'step-start', 'step-end', 'attachment']);

/**
 * The line one `cy.task('probara', …)` sends: what the support file sent. A helper's message is
 * `{ type: 'title', value: … }`, a step or an attached file a line of the transport; the reporter
 * stamps both with the attempt that was running. `undefined` for a payload that is no line, which
 * is dropped rather than reported as a test's own.
 */
function lineOf(payload: unknown): Record<string, unknown> | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const { type } = payload as { type?: unknown };
  if (typeof type !== 'string') return undefined;
  return LINE_TYPES.has(type) ? { ...payload } : { type: 'message', message: payload };
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
    // cannot read, and the reporter resolves the same options in its own process.
    const given = (config.reporterOptions ?? {}) as ProbaraCypressOptions;
    const setup = resolveSetup(given, config.projectRoot);
    const { logger } = setup.core;
    for (const warning of setup.warnings) logger?.warn(warning);
    openRun(setup, config.isInteractive === true);
    let spec = '';
    let selection: Promise<RunSelection | undefined> | undefined;

    on('before:run', (details: CypressBeforeRun) => {
      setBrowser(details.browser?.name);
    });

    on('before:spec', async (given_: { relative: string }) => {
      spec = given_.relative;
      beginSpec(spec);
      // Read once, however many specs the run has: every spec reads what the first one read.
      selection ??= setup.runCasesOnly ? readSelection(setup, logger) : undefined;
      await expose(config, setup, selection);
    });

    on('after:screenshot', (details: CypressScreenshotDetails) => {
      addScreenshot(spec, details.path);
    });

    on('after:spec', (given_: { relative: string }, results: CypressSpecResults) => {
      endSpec(given_.relative, videoOf(results), results.stats?.failures ?? 0);
    });

    // Awaited by Cypress before it ends the run: everything the reporter handed over is sent, and
    // the run this created is closed, whatever the exit code of the tests was.
    on('after:run', async () => {
      if (runLogger() === undefined) logger?.warn(REPORTER_MISSING);
      await completeRun();
      closeRun();
    });

    on('task', {
      probara(payload: unknown) {
        const line = lineOf(payload);
        if (line !== undefined) addLine(line);
        return null;
      },
    });

    void expose(config, setup, undefined);
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
 * What the browser side of this run needs (`Cypress.expose('probara')`): the version of the
 * package, whether to capture the console, and the cases of the run `runCasesOnly` takes its tests
 * from. Left out entirely when nothing is reported, so the helpers stay quiet.
 */
async function expose(
  config: CypressPluginConfig,
  setup: Setup,
  selection: Promise<RunSelection | undefined> | undefined,
): Promise<void> {
  config.expose = config.expose ?? {};
  config.expose.probara = {
    version: VERSION,
    captureOutput: setup.captureOutput,
    ...(selection === undefined ? {} : { selection: await selection }),
  };
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
