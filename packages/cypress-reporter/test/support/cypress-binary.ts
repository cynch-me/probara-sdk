/**
 * The Cypress the end-to-end tests of this package run: the `cypress` dependency is only the command
 * line, and the application it drives is a binary that a postinstall script of its own downloads
 * into a cache folder outside the project.
 *
 * That is a trap for a fresh machine. pnpm 10 does not run the install scripts of dependencies
 * unless the workspace allows them (`onlyBuiltDependencies` in `pnpm-workspace.yaml`), so a CI
 * runner installs the command and never the binary, and every `cypress run` then ends at once,
 * before a spec is even parsed (measured with Cypress 16.1.1: exit code 1, `The cypress npm
 * package is installed, but the Cypress binary is missing`). A suite of end-to-end tests sees that
 * as dozens of unrelated failures — nothing was reported, nothing was attached, no line was logged —
 * instead of the one reason there is.
 *
 * So the runs ask Cypress itself, once per test process, before the first one starts. The answer
 * is one line naming what is missing and the two commands that fix it, whichever of them the
 * machine can use.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runNode } from './workspace.js';

const require = createRequire(__filename);
/** Where the `cypress` dependency this package is developed against is installed. */
export const CYPRESS_DIR = dirname(require.resolve('cypress/package.json'));
/** The command a user runs, and the one these tests run. */
export const CYPRESS_BIN = join(CYPRESS_DIR, 'bin', 'cypress');

/** The warning of a machine whose Cypress binary was never installed. */
const BINARY_MISSING =
  'The Cypress binary is not installed, so no cypress run of these tests can start: every run ends at once with "The cypress npm package is installed, but the Cypress binary is missing" (exit code 1, no spec parsed). pnpm runs the install script of a dependency only when the workspace allows it: add "cypress" to onlyBuiltDependencies in pnpm-workspace.yaml and install again, or run "pnpm exec cypress install" to fetch the binary now.';

/** What `cypress version` prints when the binary it found is the one of the package. */
const BINARY_VERSION = /^Cypress binary version:\s*(.+)$/m;

/** What one run of the `cypress` command answered. */
export interface CommandAnswer {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Asks the `cypress` command what it is, in the environment a run of it gets (`env` apart). */
export async function probeBinary(env: Record<string, string> = {}): Promise<CommandAnswer> {
  const answer = await runNode([CYPRESS_BIN, 'version'], process.cwd(), env, { timeoutMs: 60_000 });
  return { exitCode: answer.exitCode, stdout: answer.stdout, stderr: answer.stderr };
}

/**
 * Throws when a `cypress run` of these tests could not start, and nothing at all when it can.
 *
 * The check is Cypress's own answer to `cypress version`, which names the binary it found (or that
 * it did not): nothing here has to know where Cypress keeps it, or what a machine has.
 */
export async function checkCypressBinary(probe: () => Promise<CommandAnswer>): Promise<void> {
  let answer: CommandAnswer;
  try {
    answer = await probe();
  } catch (error) {
    throw new Error(
      `The cypress command could not be run, so no cypress run of these tests can start: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (answer.exitCode !== 0) {
    throw new Error(
      `The cypress command failed, so no cypress run of these tests can start (exit code ${String(answer.exitCode)}): ${answer.stderr.trim() || answer.stdout.trim()}`,
    );
  }
  // The version it found, `not installed` where there is none (and whatever else it says, a
  // Cypress that answered at all is a Cypress whose command line runs).
  const found = BINARY_VERSION.exec(answer.stdout)?.[1]?.trim() ?? '';
  if (found === '' || found.toLowerCase().includes('not installed'))
    throw new Error(BINARY_MISSING);
}

/**
 * {@link checkCypressBinary} over the real `cypress` command, in the environment a run of it gets.
 *
 * It takes nothing on purpose: it is written as the `beforeAll` of a test file, and a hook Vitest
 * reads a parameter of takes it for a fixture to inject.
 */
export function ensureCypressBinary(): Promise<void> {
  return checkCypressBinary(async () => probeBinary());
}

let checked: Promise<void> | undefined;

/**
 * {@link ensureCypressBinary}, once per process: the answer cannot change under a test file, and a
 * run that cannot start should say why once rather than once per spec. A refusal is remembered as
 * well, so every run of the file reports the same one reason.
 */
export function ensureCypressBinaryOnce(): Promise<void> {
  checked ??= ensureCypressBinary();
  return checked;
}
