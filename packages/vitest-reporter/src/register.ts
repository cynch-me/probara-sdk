/**
 * Registers the reporter's setup file and runner extension in one project of a run (V-D5, V-D7):
 * the setup file goes first in the project's `setupFiles`, the user's own follow in their order, and
 * the runner is replaced by the reporter's, which wraps the user's own (its path is provided). Pure:
 * the project is the part of Vitest's `TestProject` that is read and written, so the unit tests need
 * no Vitest run. A project that cannot be changed degrades with a warning; the run goes on.
 */
import { CUSTOM_RUNNER_KEY } from './runner-key.js';

/** The part of a Vitest project the registration reads and writes. */
export interface ProjectLike {
  readonly name: string;
  readonly config: {
    setupFiles: string[];
    runner?: string | undefined;
    readonly browser: { readonly enabled: boolean };
  };
  provide(key: 'probaraCustomRunner', value: string): void;
}

/** Where the reporter's built files are, and whether this Node imports a TypeScript file as it is. */
export interface RegistrationOptions {
  /** The built setup file (`dist/setup.js`). */
  setup: string;
  /** The built runner extension (`dist/runner.js`). */
  runner: string;
  /** Whether a `.ts` runner can be imported here (Node's type stripping). */
  canImportTypeScript: boolean;
}

/** What the registration of one project did. */
export interface Registration {
  /** Whether the setup file runs in the project: its attempts are recorded. */
  setup: boolean;
  /** One line per problem, each naming the project. */
  warnings: string[];
}

/** The package specifier a user may list instead of the file: it counts as registered. */
const SETUP_SPECIFIER = '@probara/vitest-reporter/setup';

const TYPESCRIPT_FILE = /\.[cm]?tsx?$/;

const DEGRADED = 'its retries and repeats are reported as their final attempt only';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Registers the setup file and the runner extension in `project`. */
export function registerProject(project: ProjectLike, options: RegistrationOptions): Registration {
  const { name, config } = project;
  if (config.browser.enabled) {
    return {
      setup: false,
      warnings: [`project "${name}" runs in browser mode: ${DEGRADED}`],
    };
  }
  const warnings: string[] = [];
  let setup = true;
  try {
    if (!config.setupFiles.some((file) => file === options.setup || file === SETUP_SPECIFIER)) {
      config.setupFiles.unshift(options.setup);
    }
  } catch (error) {
    setup = false;
    warnings.push(
      `could not add the setup file to project "${name}" (${messageOf(error)}): ${DEGRADED}`,
    );
  }
  const custom = config.runner ?? '';
  if (custom === options.runner) return { setup, warnings };
  if (TYPESCRIPT_FILE.test(custom) && !options.canImportTypeScript) {
    warnings.push(
      `the runner of project "${name}" is TypeScript, which this Node cannot import: the reporter keeps it as it is`,
    );
    return { setup, warnings };
  }
  try {
    project.provide(CUSTOM_RUNNER_KEY, custom);
    config.runner = options.runner;
  } catch (error) {
    warnings.push(
      `could not wrap the runner of project "${name}" (${messageOf(error)}): the reporter keeps it as it is`,
    );
  }
  return { setup, warnings };
}
