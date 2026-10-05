/**
 * `@probara/cypress-reporter/setup`: the `setupNodeEvents` of the Cypress config. It turns on what
 * the reporter can only do from the Node side of the run: the `probara` task the `probara.*`
 * helpers of the support file call, the spec files Cypress reports (`before:spec`), the screenshots
 * (`after:screenshot`) and videos (`after:spec`) it attaches, and the end of the run, where the run
 * is completed and closed (`after:run`).
 *
 * Without it the reporter still sends every result, and the run is completed on the process's way
 * out instead; one warning names what is missing.
 */
import type {
  CypressBeforeRun,
  CypressPluginConfig,
  CypressPluginEvents,
  CypressScreenshotDetails,
  CypressSpecResults,
} from './cypress.js';
import { session } from './session.js';
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

/** The lines of the transport that carry what a helper said about the running attempt. */
const ATTEMPT_LINE_TYPES = new Set(['message', 'step-start', 'step-end', 'attachment']);

/**
 * The line one `cy.task('probara', …)` carries: what the support file sent, with the attempt the
 * reporter stamps on it. `undefined` for a payload that is no line at all, which is dropped with
 * one warning rather than reported as a test's own.
 */
function lineOf(payload: unknown): Record<string, unknown> | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const { type } = payload as { type?: unknown };
  if (typeof type !== 'string') return undefined;
  // A helper's message is `{ type: 'title', value: … }`; a step or an attached file is a line of
  // the transport itself. The attempt both are stamped with comes from the reporter.
  return ATTEMPT_LINE_TYPES.has(type) ? { ...payload } : { type: 'message', message: payload };
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
    session.setPluginSeen();
    // The plugin runs before the first spec, and knows what the reporter alone cannot: the project
    // root and whether the run is interactive.
    session.setup(config.reporterOptions, config.projectRoot);
    session.setInteractive(config.isInteractive === true);

    on('before:run', (details: CypressBeforeRun) => {
      session.setBrowser(details.browser?.name);
    });

    // Awaited by Cypress before the spec loads, so the browser of the first spec already finds
    // what the plugin exposed (the selection of `runCasesOnly` is read once, here).
    on('before:spec', async (spec: { relative: string }) => {
      await expose(config);
      session.beginSpec(spec.relative);
    });

    on('after:screenshot', (details: CypressScreenshotDetails) => {
      session.addScreenshot(session.currentSpec() ?? '', details.path);
    });

    on('after:spec', (spec: { relative: string }, results: CypressSpecResults) => {
      session.afterSpec(spec.relative, results);
    });

    // Awaited by Cypress before the run ends: everything the run reported is sent (and the run
    // closed) before Cypress exits, whatever the exit code of the tests was.
    on('after:run', async () => {
      // A run whose Cypress config registers no reporter: nothing was sent, and the log says why.
      if (!session.reporterSeen()) session.warnOnce(REPORTER_MISSING, 'the run');
      await session.complete();
    });

    on('task', {
      probara(payload: unknown) {
        try {
          const line = lineOf(payload);
          if (line === undefined) {
            session.warnOnce(
              'Ignored a probara task that carries no helper message',
              'a probara task',
            );
            return null;
          }
          session.addLine(line);
        } catch {
          // A task must never fail a test: whatever it sent is lost, and nothing is thrown.
        }
        return null;
      },
    });

    void expose(config);
    return config;
  } catch {
    // The plugin must never break the run: nothing is reported, and the log says why.
    session.logError('Probara reporting is off: probaraNodeEvents could not register the run');
    return config;
  }
}

/**
 * What the browser side of this run needs (`Cypress.expose('probara')`): the version of the
 * package, whether to capture the console, and the cases of the run `runCasesOnly` takes its
 * tests from. Left out entirely when nothing is reported, so the helpers stay quiet.
 */
async function expose(config: CypressPluginConfig): Promise<void> {
  const setup = session.resolved();
  // Nothing is reported: the helpers stay quiet, and the browser reads nothing of this package.
  if (setup === undefined || !session.reporting()) return;
  const selection = setup.runCasesOnly ? await session.readSelection() : undefined;
  config.expose = config.expose ?? {};
  config.expose.probara = {
    version: VERSION,
    captureOutput: setup.captureOutput,
    ...(selection === undefined ? {} : { selection }),
  };
}
