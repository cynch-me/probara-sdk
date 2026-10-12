/**
 * Registers the reporter's setup file and runner extension in one project of a run (V-D5, V-D7):
 * the setup file goes first in the project's `setupFiles`, the user's own follow in their order, and
 * the runner is replaced by the reporter's, which wraps the user's own (its path is provided), unless
 * Node cannot import the user's file: that runner is kept as it is, with a warning. Pure:
 * the project is the part of Vitest's `TestProject` that is read and written, so the unit tests need
 * no Vitest run. A project that cannot be changed degrades with a warning; the run goes on.
 */
import { extname } from 'node:path';
import { FILES_KEY } from './files-key.js';
import { CUSTOM_RUNNER_KEY } from './runner-key.js';

/** The part of a Vitest project the registration reads and writes. */
export interface ProjectLike {
  readonly name: string;
  readonly config: {
    setupFiles: string[];
    runner?: string | undefined;
    readonly browser: { readonly enabled: boolean; commands?: Record<string, unknown> | undefined };
  };
  provide(key: 'probaraCustomRunner' | 'probaraFilesDir', value: string): void;
}

/** Where the reporter's built files are, and whether this Node imports a TypeScript file as it is. */
export interface RegistrationOptions {
  /** The built setup file (`dist/setup.js`). */
  setup: string;
  /** The built runner extension (`dist/runner.js`). */
  runner: string;
  /** Whether a `.ts` runner can be imported here (Node's type stripping). */
  canImportTypeScript: boolean;
  /** The folder the files of `probara.attach()` are copied into, provided with the setup file (V-D66). */
  filesDir?: string | undefined;
  /** The browser setup file of the project's Vitest major (V10): the file a browser project runs with. */
  browserSetup?: string | undefined;
  /** The browser commands the reporter adds to each browser project, by name (V10: `probaraAttach`). */
  browserCommands?: Record<string, unknown> | undefined;
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
/** The browser setup's package specifier: a browser project that lists it counts as registered too (as the Node one). */
const BROWSER_SETUP_SPECIFIER = '@probara/vitest-reporter/setup/browser';

/** The extensions Node imports as they are: JavaScript always, TypeScript only where it strips types. */
const JAVASCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(['.js', '.mjs', '.cjs']);
const TYPESCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.mts', '.cts']);

/**
 * Whether Node imports the file at `path` itself: the runner extension imports the user's runner with
 * a native `import()`, which fails for any other extension (`.jsx`, `.tsx`, none), though Vite, which
 * Vitest runs the runner with, transforms them.
 */
function importedByNode(path: string, canImportTypeScript: boolean): boolean {
  const extension = extname(path);
  return (
    JAVASCRIPT_EXTENSIONS.has(extension) ||
    (canImportTypeScript && TYPESCRIPT_EXTENSIONS.has(extension))
  );
}

/** Why Node does not import the runner at `path`, for the warning that says the reporter keeps it. */
function unimportedReason(path: string, canImportTypeScript: boolean): string {
  if (TYPESCRIPT_EXTENSIONS.has(extname(path)) && !canImportTypeScript) {
    return 'is TypeScript, which this Node cannot import';
  }
  return `is ${path}, which Node does not import`;
}

const DEGRADED = 'its retries and repeats are reported as their final attempt only';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The browser commands of a project's configuration, as the reporter sets them (its names replace any of the same name). */
export interface BrowserConfigLike {
  browser: { commands?: Record<string, unknown> | undefined };
}

/**
 * Sets the browser commands in a configuration. The reporter's names are its own: a command of the same name is replaced,
 * so a re-created reporter's handler wins. Vitest builds a browser's parent from the configuration of the workspace project
 * it belongs to, so the commands go to that configuration too (V10).
 */
export function addBrowserCommands(
  config: BrowserConfigLike,
  commands: Record<string, unknown>,
): void {
  config.browser.commands ??= {};
  const target = config.browser.commands;
  for (const [command, handler] of Object.entries(commands)) {
    target[command] = handler;
  }
}

/**
 * Registers a browser project (V10): the browser setup file of its Vitest major goes first in `setupFiles`, its files
 * folder is provided, and the reporter's browser commands are set by name (a command of the same name is replaced).
 * The runner is not replaced: a browser runs its own tests, so the reporter wraps no runner there.
 */
function registerBrowserProject(project: ProjectLike, options: RegistrationOptions): Registration {
  const { name, config } = project;
  const setupFile = options.browserSetup;
  if (setupFile === undefined) {
    return {
      setup: false,
      warnings: [
        `project "${name}" runs in browser mode: ${DEGRADED}, and its probara.* helpers record nothing`,
      ],
    };
  }
  const warnings: string[] = [];
  let setup = true;
  try {
    if (!config.setupFiles.some((file) => file === setupFile || file === BROWSER_SETUP_SPECIFIER)) {
      config.setupFiles.unshift(setupFile);
    }
  } catch (error) {
    setup = false;
    warnings.push(
      `could not add the browser setup file to project "${name}" (${messageOf(error)}): ${DEGRADED}`,
    );
  }
  if (setup && options.filesDir !== undefined) {
    try {
      project.provide(FILES_KEY, options.filesDir);
    } catch (error) {
      warnings.push(
        `could not give project "${name}" its attachments folder (${messageOf(error)}): its files are not attached`,
      );
    }
  }
  if (setup && options.browserCommands !== undefined) {
    try {
      addBrowserCommands(config, options.browserCommands);
    } catch (error) {
      warnings.push(
        `could not add the browser commands to project "${name}" (${messageOf(error)}): its probara.attach() copies no file`,
      );
    }
  }
  return { setup, warnings };
}

/** Registers the setup file and the runner extension in `project`. */
export function registerProject(project: ProjectLike, options: RegistrationOptions): Registration {
  const { name, config } = project;
  if (config.browser.enabled) return registerBrowserProject(project, options);
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
  if (setup && options.filesDir !== undefined) {
    try {
      project.provide(FILES_KEY, options.filesDir);
    } catch (error) {
      warnings.push(
        `could not give project "${name}" its attachments folder (${messageOf(error)}): its files are not attached`,
      );
    }
  }
  const custom = config.runner ?? '';
  if (custom === options.runner) return { setup, warnings };
  // The default runner (no user runner, `''`) needs no import of a file: it is wrapped as it is.
  if (custom !== '' && !importedByNode(custom, options.canImportTypeScript)) {
    const reason = unimportedReason(custom, options.canImportTypeScript);
    warnings.push(`the runner of project "${name}" ${reason}: the reporter keeps it as it is`);
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
