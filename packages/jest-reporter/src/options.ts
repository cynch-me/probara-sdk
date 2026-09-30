/** The reporter's options: core's, plus the settings only a Jest reporter has. */
import {
  resolveAdapterSetup,
  resolveBooleanSetting,
  type AdapterSetup,
  type ProbaraOptions,
  type RuntimeOptions,
} from '@probara/core';
import { VERSION } from './version.js';

/** Sent first in the User-Agent. */
export const CLIENT_NAME = `probara-jest-reporter/${VERSION}`;

/**
 * The options of `['@probara/jest-reporter', options]` in the Jest config: every option of
 * `@probara/core` under the same name, `keyIncludesFile` and `captureOutput`. Each falls back to its
 * `PROBARA_*` variable, then to its default.
 */
export interface ProbaraJestOptions extends ProbaraOptions, RuntimeOptions {
  /**
   * `PROBARA_KEY_INCLUDES_FILE`: start the automation key with the test file, like `probara import
   * junit` on jest-junit output written with `JEST_JUNIT_ADD_FILE_ATTRIBUTE=true`. `false` gives
   * the keys of jest-junit's default output, without the file. Defaults to `true`.
   */
  keyIncludesFile?: boolean | undefined;
  /**
   * `PROBARA_CAPTURE_OUTPUT`: attach what each attempt writes to the console as `stdout.log` and
   * `stderr.log`, like the Playwright reporter. Needs the setup file
   * (`setupFilesAfterEnv: ['@probara/jest-reporter/setup']`). Defaults to `false`.
   */
  captureOutput?: boolean | undefined;
}

/** What the reporter needs once Jest began the run: core's adapter setup, and its own. */
export interface Setup extends AdapterSetup {
  keyIncludesFile: boolean;
  captureOutput: boolean;
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
 * directory jest-junit's paths are relative to: the real path of the working directory), the
 * reporter's client name, and a logger on stderr (stdout belongs to Jest's own reporters). An option
 * it does not know is left out with a warning.
 */
export function resolveSetup(options: ProbaraJestOptions, rootDir: string): Setup {
  const { keyIncludesFile: keyOption, captureOutput: captureOption, ...rest } = options;
  const own: Record<string, unknown> = {};
  const warnings: string[] = [];
  for (const [name, value] of Object.entries(rest)) {
    if (isCoreOption(name)) own[name] = value;
    else warnings.push(`Ignored the unknown option "${name}" of @probara/jest-reporter`);
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
  const setup = resolveAdapterSetup(core, {
    rootDir,
    clientName: CLIENT_NAME,
    adapterProblems: [keyIncludesFile.problem, captureOutput.problem].filter(
      (problem) => problem !== undefined,
    ),
  });
  return {
    ...setup,
    keyIncludesFile: keyIncludesFile.value ?? true,
    captureOutput: captureOutput.value ?? false,
    warnings,
  };
}
