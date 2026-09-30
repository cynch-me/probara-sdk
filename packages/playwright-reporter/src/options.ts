/** The reporter's options: core's, plus the settings only a Playwright reporter has. */
import {
  createConsoleLogger,
  resolveBooleanSetting,
  resolveConfig,
  type Logger,
  type ProbaraOptions,
  type ReporterOptions,
  type RuntimeOptions,
} from '@probara/core';
import { VERSION } from './version.js';

/** Sent first in the User-Agent. */
export const CLIENT_NAME = `probara-playwright-reporter/${VERSION}`;

/**
 * The options of `['@probara/playwright-reporter', options]` in `playwright.config`: every option of
 * `@probara/core` under the same name, and `captureOutput`. Each falls back to its `PROBARA_*`
 * variable, then to its default.
 */
export interface ProbaraPlaywrightOptions extends ProbaraOptions, RuntimeOptions {
  /** `PROBARA_CAPTURE_OUTPUT`: attach each attempt's stdout and stderr. Defaults to `false`. */
  captureOutput?: boolean | undefined;
}

/** What the reporter needs once Playwright began the run. */
export interface Setup {
  core: ReporterOptions;
  /** The project code whose case ids are read from titles, once reporting can be on. */
  projectCode: string | undefined;
  captureOutput: boolean;
}

/** Options Playwright adds to every reporter's (`configDir`, `_mode`...): never core's. */
function isPlaywrightOption(name: string): boolean {
  return name === 'configDir' || name.startsWith('_');
}

/**
 * The core options of a run: the reporter options, with `rootDir` defaulting to Playwright's (the
 * directory the JUnit reporter's paths are relative to), the reporter's client name, and a logger on
 * stderr (stdout belongs to Playwright's own reporters).
 */
export function resolveSetup(options: ProbaraPlaywrightOptions, rootDir: string): Setup {
  const { captureOutput: captureOption, ...rest } = options;
  const own = Object.fromEntries(
    Object.entries(rest).filter(([name]) => !isPlaywrightOption(name)),
  ) as ProbaraOptions & RuntimeOptions;
  const env = own.env ?? process.env;
  const capture = resolveBooleanSetting(
    captureOption,
    'captureOutput',
    'PROBARA_CAPTURE_OUTPUT',
    env,
  );
  const resolved: ProbaraOptions = {
    ...own,
    rootDir: own.rootDir ?? rootDir,
    clientName: CLIENT_NAME,
  };
  const resolution = resolveConfig(resolved, env);
  const debug = resolution.ok
    ? resolution.config.debug
    : (resolveBooleanSetting(own.debug, 'debug', 'PROBARA_DEBUG', env).value ?? false);
  const logger: Logger = own.logger ?? createConsoleLogger({ debug, stderr: true });
  return {
    core: {
      ...resolved,
      logger,
      ...(capture.problem === undefined ? {} : { adapterProblems: [capture.problem] }),
    },
    projectCode: resolution.ok ? resolution.config.projectId : undefined,
    captureOutput: capture.value ?? false,
  };
}
