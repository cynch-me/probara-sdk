/**
 * A throwaway copy of the fixture project, laid out like a user's: `node_modules` holds a copy of
 * the built reporter (by its package name), `@probara/core` and `cypress` itself. Cypress runs from
 * its bin, in the version the reporter is tested against. Commands run as child processes, without
 * blocking the event loop, so the fake Probara of the test can answer them.
 *
 * No network in a test: the Cypress binary is the one already in the machine's cache (the same one
 * the package's own `cypress` dev dependency installs), found through `HOME`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BROKEN_SPEC, NO_PLUGIN, PROJECT } from './project.js';

const require = createRequire(__filename);
export const PACKAGE_DIR = join(__dirname, '..', '..');
export const CLI_BIN = join(
  dirname(require.resolve('@probara/cli/package.json')),
  'dist',
  'cli.js',
);
export const CORE_DIR = dirname(require.resolve('@probara/core/package.json'));
const CYPRESS_DIR = dirname(require.resolve('cypress/package.json'));

/** A token that must never show up in any output. */
export const TOKEN = 'prb_test_T0KEN_must_never_leak_42';

export interface CommandRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Nothing of the real environment (CI variables, PROBARA_*, CYPRESS_*) leaks in. */
function childEnv(env: Record<string, string>): Record<string, string> {
  return { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env };
}

/**
 * `node <args>` in `cwd`, with only `env` (plus PATH and HOME) around it. With `timeoutMs`, a
 * command still running then is killed, and the promise rejects with what it printed.
 */
export function runNode(
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
  { timeoutMs }: { timeoutMs?: number } = {},
): Promise<CommandRun> {
  return new Promise((resolve, reject) => {
    // A process that could not start (EMFILE) has no stdout nor stderr, and emits `error` only:
    // the listeners that end the promise and clear the timer come first.
    const child: ChildProcess = spawn(process.execPath, args, { cwd, env: childEnv(env) });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`node ${args.join(' ')} did not end in time, and was killed:\n${stderr}`));
      } else {
        resolve({ exitCode: code ?? -1, stdout, stderr });
      }
    });
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    // Armed after the listeners that clear it: an `error` comes on a later tick at the soonest.
    if (timeoutMs !== undefined) {
      timer = setTimeout(
        () => {
          timedOut = true;
          child.kill('SIGKILL');
        },
        Math.max(timeoutMs, 0),
      );
    }
  });
}

export interface Workspace {
  readonly dir: string;
  /** `cypress run <args>` in the workspace, with only `env` (plus PATH and HOME) around it. */
  cypress(args: readonly string[], env?: Record<string, string>): Promise<CommandRun>;
  /** The built `probara` bin in the workspace. */
  probara(args: readonly string[], env?: Record<string, string>): Promise<CommandRun>;
  remove(): Promise<void>;
}

/** The environment of a configured CI job reporting to `baseUrl`. */
export function probaraEnv(
  baseUrl: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    PROBARA_API_TOKEN: TOKEN,
    PROBARA_PROJECT: 'SHOP',
    PROBARA_BASE_URL: baseUrl,
    ...extra,
  };
}

/** Writes each file of a project, creating the folders it needs. */
export async function writeProject(
  dir: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
}

/**
 * The `node_modules` of a project in `dir`, as a user's install lays it out: a copy of the built
 * reporter (by its package name), `@probara/core` and `cypress` itself.
 */
async function installPackages(dir: string): Promise<void> {
  await mkdir(join(dir, 'node_modules', '@probara'), { recursive: true });
  const reporterDir = join(dir, 'node_modules', '@probara', 'cypress-reporter');
  await mkdir(reporterDir);
  await cp(join(PACKAGE_DIR, 'package.json'), join(reporterDir, 'package.json'));
  await cp(join(PACKAGE_DIR, 'dist'), join(reporterDir, 'dist'), { recursive: true });
  await symlink(CORE_DIR, join(dir, 'node_modules', '@probara', 'core'));
  await symlink(CYPRESS_DIR, join(dir, 'node_modules', 'cypress'));
}

/**
 * A throwaway project, as a user lays one out: `project` registers the reporter and its plugin,
 * `no-plugin` the reporter alone. Every workspace holds the spec Cypress cannot parse
 * ({@link BROKEN_SPEC}) too, unless the test asks for one without it.
 */
export async function createWorkspace(
  fixture: 'project' | 'no-plugin' = 'project',
  { broken = true }: { broken?: boolean } = {},
): Promise<Workspace> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'probara-cypress-workspace-')));
  await writeProject(dir, fixture === 'no-plugin' ? { ...PROJECT, ...NO_PLUGIN } : PROJECT);
  if (broken) await writeProject(dir, { 'cypress/e2e/broken.cy.js': BROKEN_SPEC });
  await installPackages(dir);
  const cypressBin = join(CYPRESS_DIR, 'bin', 'cypress');
  return {
    dir,
    cypress: (args, env = {}) =>
      runNode([cypressBin, 'run', ...args], dir, env, { timeoutMs: 240_000 }),
    probara: (args, env = {}) => runNode([CLI_BIN, ...args], dir, env, { timeoutMs: 60_000 }),
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}
