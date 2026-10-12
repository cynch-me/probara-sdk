/** The reporter's options: core's, plus the settings only a Vitest reporter has. */
import {
  resolveAdapterSetup,
  resolveBooleanSetting,
  resolveUrlTemplateSetting,
  splitCoreOptions,
  type AdapterSetup,
  type ProbaraOptions,
  type RuntimeOptions,
} from '@probara/core';
import { probaraLogger, type LogSink } from './logger.js';
import { VERSION } from './version.js';

/** Sent first in the User-Agent. */
export const CLIENT_NAME = `probara-vitest-reporter/${VERSION}`;

/**
 * The options of `['@probara/vitest-reporter', options]` in the Vitest config: every option of
 * `@probara/core` under the same name, plus `keyIncludesFile`, `captureOutput`,
 * `attachScreenshots`, `issueUrlTemplate` and `runCasesOnly`. Each falls back to its `PROBARA_*`
 * variable, then to its default. Every one is read and checked now; `captureOutput`,
 * `attachScreenshots`, `issueUrlTemplate` and `runCasesOnly` take effect with their own tasks.
 */
export interface ProbaraVitestOptions extends ProbaraOptions, RuntimeOptions {
  /**
   * `PROBARA_KEY_INCLUDES_FILE`: start the automation key with the test file, like `probara import
   * junit` on Vitest's JUnit output written with `addFileAttribute: true`. `false` gives the keys
   * of the default output, without the file. Defaults to `true`.
   */
  keyIncludesFile?: boolean | undefined;
  /**
   * `PROBARA_CAPTURE_OUTPUT`: attach what each attempt writes to the console as `stdout.log` and
   * `stderr.log`, like the Jest and Playwright reporters. Defaults to `false`.
   */
  captureOutput?: boolean | undefined;
  /**
   * `PROBARA_ATTACH_SCREENSHOTS`: attach the browser mode's failure screenshots to the attempt
   * that failed. `false` leaves them out. Defaults to `true`.
   */
  attachScreenshots?: boolean | undefined;
  /**
   * `PROBARA_ISSUE_URL_TEMPLATE`: the URL each `probara.issue(id)` becomes, an http(s) URL with `%s`
   * where the URL-encoded id goes (`https://jira.example.com/browse/%s`). Without it, issues are
   * dropped with a warning.
   */
  issueUrlTemplate?: string | undefined;
  /**
   * `PROBARA_RUN_CASES_ONLY`: run only the tests of the cases of the run `run.ulid`
   * (`PROBARA_RUN_ULID`), matched by automation key or by a case id in their names; the others
   * are skipped and not reported. Defaults to `false`.
   */
  runCasesOnly?: boolean | undefined;
}

/** What the reporter needs once Vitest began: core's adapter setup, and its own. */
export interface Setup extends AdapterSetup {
  keyIncludesFile: boolean;
  captureOutput: boolean;
  attachScreenshots: boolean;
  /** What `probara.issue()` ids become (`issueUrlTemplate`); none when unset. */
  issueUrlTemplate: string | undefined;
  runCasesOnly: boolean;
  /** Options the reporter does not know, one line each: reporting stays on. */
  warnings: string[];
}

/** What {@link resolveSetup} needs from Vitest: its root and its logger. */
export interface SetupContext {
  /** The Vitest root: the directory the test files are relative to, unless `rootDir` is set. */
  rootDir: string;
  /** Vitest's logger, where every `[probara]` line goes (see `logger.ts`). */
  sink: LogSink;
}

/**
 * The setup of a run: core's options with `rootDir` defaulting to the Vitest root, the reporter's
 * client name, and a logger on the Vitest sink (unless the options give one), plus the reporter's
 * own settings. An option it does not know is left out with a warning; a setting that is not valid
 * turns reporting off with an error, which core logs.
 */
export function resolveSetup(options: ProbaraVitestOptions, context: SetupContext): Setup {
  const {
    keyIncludesFile: keyOption,
    captureOutput: captureOption,
    attachScreenshots: screenshotsOption,
    issueUrlTemplate: templateOption,
    runCasesOnly: selectionOption,
    ...rest
  } = options;
  const { core, warnings } = splitCoreOptions(rest, '@probara/vitest-reporter');
  const env = core.env ?? process.env;
  const debug = resolveBooleanSetting(core.debug, 'debug', 'PROBARA_DEBUG', env).value ?? false;
  const keyIncludesFile = resolveBooleanSetting(
    keyOption,
    'keyIncludesFile',
    'PROBARA_KEY_INCLUDES_FILE',
    env,
  );
  const captureOutput = resolveBooleanSetting(
    captureOption,
    'captureOutput',
    'PROBARA_CAPTURE_OUTPUT',
    env,
  );
  const attachScreenshots = resolveBooleanSetting(
    screenshotsOption,
    'attachScreenshots',
    'PROBARA_ATTACH_SCREENSHOTS',
    env,
  );
  const runCasesOnly = resolveBooleanSetting(
    selectionOption,
    'runCasesOnly',
    'PROBARA_RUN_CASES_ONLY',
    env,
  );
  const issueUrlTemplate = resolveUrlTemplateSetting(
    templateOption,
    'issueUrlTemplate',
    'PROBARA_ISSUE_URL_TEMPLATE',
    env,
  );
  const setup = resolveAdapterSetup(
    { ...core, logger: core.logger ?? probaraLogger(context.sink, debug) },
    {
      rootDir: context.rootDir,
      clientName: CLIENT_NAME,
      adapterProblems: [
        keyIncludesFile.problem,
        captureOutput.problem,
        attachScreenshots.problem,
        issueUrlTemplate.problem,
        runCasesOnly.problem,
      ].filter((problem) => problem !== undefined),
    },
  );
  return {
    ...setup,
    keyIncludesFile: keyIncludesFile.value ?? true,
    captureOutput: captureOutput.value ?? false,
    attachScreenshots: attachScreenshots.value ?? true,
    issueUrlTemplate: issueUrlTemplate.value,
    runCasesOnly: runCasesOnly.value ?? false,
    warnings,
  };
}
