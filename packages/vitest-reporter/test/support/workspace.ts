/**
 * A throwaway copy of a fixture project, laid out like a user's: `node_modules` holds a copy of the
 * built reporter (by its package name), `@probara/core`, and the Vitest major's own install. Vitest
 * runs from its bin, in each major the reporter supports. The child processes get only `PATH`,
 * `HOME` and what the test passes: nothing of the outer runner's environment (its `VITEST*` and
 * `VITE*` variables would make a Vitest started here think it is a worker). Commands run as child
 * processes, without blocking the event loop, so the fake Probara of a test can answer them.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_BIN } from '@probara/test-support/build';

const require = createRequire(import.meta.url);
export const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));
export const CORE_DIR = dirname(require.resolve('@probara/core/package.json'));

/** The real directory of one of the package's installs (an npm alias, or `vitest` itself). */
export function installOf(name: string): string {
  return realpathSync(join(PACKAGE_DIR, 'node_modules', name));
}

/**
 * The Vitest majors the end-to-end tests run: the oldest line of the peer range, the middle one and
 * the latest. Each one is an install of its own (`vitest-3`, `vitest-4` are npm aliases).
 */
export const VITEST_VERSIONS = [
  { name: 'Vitest 3', dir: installOf('vitest-3') },
  { name: 'Vitest 4', dir: installOf('vitest-4') },
  { name: 'Vitest 5', dir: installOf('vitest') },
] as const;

export type VitestVersion = (typeof VITEST_VERSIONS)[number];

/** A token that must never show up in any output. */
export const TOKEN = 'prb_test_T0KEN_must_never_leak_42';

export interface CommandRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** A command still running: its process, and what it printed so far on stdout and stderr. */
export interface RunningCommand {
  readonly child: ChildProcess;
  output(): string;
  /** Resolves once it exited. */
  readonly exited: Promise<void>;
}

export interface Workspace {
  readonly dir: string;
  /** `vitest <args>` in the workspace, with only `env` (plus PATH and HOME) around it. */
  vitest(args: readonly string[], env?: Record<string, string>): Promise<CommandRun>;
  /** The same, left running (watch mode): the caller stops it. */
  startVitest(args: readonly string[], env?: Record<string, string>): RunningCommand;
  /** The built `probara` bin (`@probara/cli`), with the same environment rules as `vitest`. */
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

/** Nothing of the real environment leaks in: only PATH and HOME, and what the test adds. */
function childEnv(env: Record<string, string>): Record<string, string> {
  return { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env };
}

/** `node <args>` in `cwd`, left running; its output accumulates. */
function startNode(
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
): RunningCommand {
  // A process that could not start (EMFILE) has no stdout nor stderr, and emits `error` only.
  const child: ChildProcess = spawn(process.execPath, args, { cwd, env: childEnv(env) });
  let output = '';
  const exited = new Promise<void>((resolve) => {
    child.on('error', (error) => {
      output += String(error);
      resolve();
    });
    child.on('close', () => {
      resolve();
    });
  });
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  return { child, output: () => output, exited };
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

/** The Vitest bin of a major. */
export function vitestBinOf(vitest: VitestVersion): string {
  return join(vitest.dir, 'vitest.mjs');
}

/**
 * The `node_modules` of a project in `dir`, as a user's install lays it out: a copy of the built
 * reporter (by its package name), `@probara/core`, and `vitest` as the major's install.
 */
export async function installPackages(dir: string, vitest: VitestVersion): Promise<void> {
  await mkdir(join(dir, 'node_modules', '@probara'), { recursive: true });
  const reporterDir = join(dir, 'node_modules', '@probara', 'vitest-reporter');
  await mkdir(reporterDir);
  await cp(join(PACKAGE_DIR, 'package.json'), join(reporterDir, 'package.json'));
  await cp(join(PACKAGE_DIR, 'dist'), join(reporterDir, 'dist'), { recursive: true });
  await symlink(CORE_DIR, join(dir, 'node_modules', '@probara', 'core'));
  await symlink(vitest.dir, join(dir, 'node_modules', 'vitest'));
}

/** The fixture projects of `test/fixtures/`, one folder each. */
export type Fixture =
  | 'project'
  | 'failures'
  | 'parity'
  | 'custom-runner'
  | 'attempts'
  | 'unloadable-runner'
  | 'broken-runner'
  | 'helpers'
  | 'attachments'
  | 'output'
  | 'watch'
  | 'shards'
  | 'projects'
  | 'bail'
  | 'selection'
  | 'links';

/**
 * A copy of the fixture project `fixture` (a folder of `test/fixtures/`) for Vitest: `project`, the
 * main one; `failures`, the files Vitest cannot collect or whose hooks throw; `parity`, the one
 * suite the parity test names on both paths; `custom-runner`, a user runner and setup file;
 * `attempts`, the retried and repeated tests; or `unloadable-runner`, a user runner in a `.jsx` file
 * that Node cannot import (with a config without the reporter, `plain.config.mts`); or `broken-runner`,
 * a user runner that throws when it loads; or `helpers`, every `probara.*` helper in a test file; or `attachments`,
 * `probara.attach()` in a test file and its shard config; or `output`, what the tests write to the console, with the
 * configs of `captureOutput`; or `watch`, one test file to change while `vitest --watch` runs, with a results-file
 * config; or `shards`, two shard configs (with the blob reporter, or the blob alone) and a retried test; or
 * `projects`, two Vitest projects that both run one file; or `bail`, two files run one at a time, the first failing.
 */
export async function createWorkspace(
  vitest: VitestVersion,
  fixture: Fixture = 'project',
): Promise<Workspace> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'probara-vitest-workspace-')));
  await cp(join(FIXTURES_DIR, fixture), dir, { recursive: true });
  await installPackages(dir, vitest);
  const bin = vitestBinOf(vitest);
  return {
    dir,
    vitest: (args, env = {}) => runNode([bin, ...args], dir, env),
    startVitest: (args, env = {}) => startNode([bin, ...args], dir, env),
    probara: (args, env = {}) => runNode([CLI_BIN, ...args], dir, env),
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}
