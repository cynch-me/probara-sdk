/** The reporter's options: core's, plus the settings only a Cypress reporter has. */
import {
  resolveAdapterSetup,
  resolveBooleanSetting,
  resolveUrlTemplateSetting,
  type AdapterSetup,
  type LogStream,
  type ProbaraOptions,
  type RuntimeOptions,
} from '@probara/core';
import { VERSION } from './version.js';

/** Sent first in the User-Agent. */
export const CLIENT_NAME = `probara-cypress-reporter/${VERSION}`;

/**
 * Where every `[probara]` line goes, in both processes of a run: stdout. The `cypress` command
 * relays the stderr of what it runs through an asynchronous line filter and exits without draining
 * it, which drops the last lines a run writes there (the attachment totals at `after:run`); stdout
 * it passes straight through.
 */
export const LOG_STREAM: LogStream = 'stdout';

/**
 * The options of `reporter: '@probara/cypress-reporter'` in `cypress.config`: every option of
 * `@probara/core` under the same name, plus `keyIncludesFile`, `captureOutput`, `attachScreenshots`,
 * `attachVideos`, `browserAsParameter`, `issueUrlTemplate` and `runCasesOnly`. Each falls back to
 * its `PROBARA_*` variable, then to its default.
 */
export interface ProbaraCypressOptions extends ProbaraOptions, RuntimeOptions {
  /**
   * `PROBARA_KEY_INCLUDES_FILE`, defaults to `true`: start the automation key with the spec file,
   * which is the `file` attribute of the root suite cypress-junit writes. `false` gives the keys of
   * a JUnit report written without it.
   */
  keyIncludesFile?: boolean | undefined;
  /**
   * `PROBARA_CAPTURE_OUTPUT`, defaults to `false`: attach what each attempt writes to the browser
   * console as `stdout.log` and `stderr.log`. Needs the support file
   * (`require('@probara/cypress-reporter/support')` in `cypress/support/e2e.js`).
   */
  captureOutput?: boolean | undefined;
  /**
   * `PROBARA_ATTACH_SCREENSHOTS`, defaults to `true`: attach the screenshot Cypress takes on a
   * failure to the result of the exact attempt, which it names after the test. `false` attaches
   * none (Cypress still takes them, into `screenshotsFolder`).
   */
  attachScreenshots?: boolean | undefined;
  /**
   * `PROBARA_ATTACH_VIDEOS`, defaults to `false`: attach the video of the spec to every failed
   * result of that spec. It costs one upload per failed result, and video files are large; needs
   * `video: true` in the Cypress config.
   */
  attachVideos?: boolean | undefined;
  /**
   * `PROBARA_BROWSER_AS_PARAMETER`, defaults to `true`: send the name of the browser Cypress runs
   * (`electron`, `chrome`, ...) as a `browser` parameter of every result. It never reaches the
   * automation key, which the JUnit import builds without a browser.
   */
  browserAsParameter?: boolean | undefined;
  /**
   * `PROBARA_ISSUE_URL_TEMPLATE`: the URL each `probara.issue(id)` becomes, an http(s) URL with `%s`
   * where the URL-encoded id goes (`https://jira.example.com/browse/%s`); the link is named by the
   * id. Without it, issues are dropped with a warning. None by default.
   */
  issueUrlTemplate?: string | undefined;
  /**
   * `PROBARA_RUN_CASES_ONLY`, defaults to `false`: run only the tests of the cases of the run
   * `run.ulid` (`PROBARA_RUN_ULID`), matched by automation key or by a case id in their titles or
   * describes (never by `probara.id()`, which runs with the test, after the selection); the others
   * are skipped by the support file and not reported. Needs the support file
   * (`require('@probara/cypress-reporter/support')`) and the plugin
   * (`setupNodeEvents`, which reads the cases of the run). When the cases cannot be read, or the
   * support file is absent, every test runs and is reported, with a warning. Cypress decides
   * `it.skip` while the spec loads, so a test that is not in the selection still runs its file's
   * module scope.
   */
  runCasesOnly?: boolean | undefined;
}

/** What the reporter and the plugin need once Cypress began the run: core's setup, and their own. */
export interface Setup extends AdapterSetup {
  keyIncludesFile: boolean;
  captureOutput: boolean;
  attachScreenshots: boolean;
  attachVideos: boolean;
  browserAsParameter: boolean;
  /** What `probara.issue()` ids become (`issueUrlTemplate`); none when unset. */
  issueUrlTemplate: string | undefined;
  runCasesOnly: boolean;
  /** Problems of the options that leave reporting on, one line each. */
  warnings: string[];
}

/** Every option core takes: the compiler keeps the list complete. */
const CORE_OPTIONS = {
  enabled: true,
  apiToken: true,
  projectId: true,
  baseUrl: true,
  run: true,
  source: true,
  createMissingCases: true,
  suiteUlid: true,
  closeRun: true,
  closeRuns: true,
  rootDir: true,
  debug: true,
  clientName: true,
  chunkSize: true,
  timeoutMs: true,
  maxRetries: true,
  uploadAttachments: true,
  attachmentConcurrency: true,
  statusMapping: true,
  statusFilter: true,
  projects: true,
  resultsFile: true,
  assignFailedTo: true,
  logger: true,
  env: true,
  fetch: true,
  sleep: true,
  random: true,
  now: true,
} satisfies Record<keyof (ProbaraOptions & RuntimeOptions), true>;

function isCoreOption(name: string): name is keyof typeof CORE_OPTIONS {
  return Object.hasOwn(CORE_OPTIONS, name);
}

/**
 * The core options of a run: the reporter options, with `rootDir` defaulting to `rootDir` (the
 * directory Cypress reports spec files relative to: `projectRoot`, else the working directory), the
 * reporter's client name, and a logger on stdout ({@link LOG_STREAM}). An option it does not know
 * is left out with a warning.
 */
export function resolveSetup(options: ProbaraCypressOptions, rootDir: string): Setup {
  const {
    keyIncludesFile: keyOption,
    captureOutput: captureOption,
    attachScreenshots: screenshotsOption,
    attachVideos: videosOption,
    browserAsParameter: browserOption,
    issueUrlTemplate: templateOption,
    runCasesOnly: selectionOption,
    ...rest
  } = options;
  const own: Record<string, unknown> = {};
  const warnings: string[] = [];
  for (const [name, value] of Object.entries(rest)) {
    if (isCoreOption(name)) own[name] = value;
    else warnings.push(`Ignored the unknown option "${name}" of @probara/cypress-reporter`);
  }
  const core = own as ProbaraOptions & RuntimeOptions;
  const env = core.env ?? process.env;
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
  const attachVideos = resolveBooleanSetting(
    videosOption,
    'attachVideos',
    'PROBARA_ATTACH_VIDEOS',
    env,
  );
  const browserAsParameter = resolveBooleanSetting(
    browserOption,
    'browserAsParameter',
    'PROBARA_BROWSER_AS_PARAMETER',
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
  const setup = resolveAdapterSetup(core, {
    rootDir,
    clientName: CLIENT_NAME,
    logStream: LOG_STREAM,
    adapterProblems: [
      keyIncludesFile.problem,
      captureOutput.problem,
      attachScreenshots.problem,
      attachVideos.problem,
      browserAsParameter.problem,
      issueUrlTemplate.problem,
      runCasesOnly.problem,
    ].filter((problem) => problem !== undefined),
  });
  return {
    ...setup,
    keyIncludesFile: keyIncludesFile.value ?? true,
    captureOutput: captureOutput.value ?? false,
    attachScreenshots: attachScreenshots.value ?? true,
    attachVideos: attachVideos.value ?? false,
    browserAsParameter: browserAsParameter.value ?? true,
    issueUrlTemplate: issueUrlTemplate.value,
    runCasesOnly: runCasesOnly.value ?? false,
    warnings,
  };
}
