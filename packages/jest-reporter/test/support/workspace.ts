/**
 * A throwaway copy of the fixture project, laid out like a user's: `node_modules` holds a copy of
 * the built reporter (by its package name), `@probara/core` and `jest-junit`. Jest itself runs from
 * its bin, in each version the reporter supports. Commands run as child processes, without blocking
 * the event loop, so the fake Probara of the test can answer them.
 */
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const require = createRequire(__filename);
export const PACKAGE_DIR = join(__dirname, '..', '..');
const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'project');
export const CLI_BIN = join(
  dirname(require.resolve('@probara/cli/package.json')),
  'dist',
  'cli.js',
);
export const CORE_DIR = dirname(require.resolve('@probara/core/package.json'));
const JEST_JUNIT_DIR = dirname(require.resolve('jest-junit/package.json'));

/** The Jest versions the end-to-end tests run: the oldest line of the peer range, and the latest. */
export const JEST_VERSIONS = [
  { name: 'Jest 29', dir: dirname(require.resolve('jest-29/package.json')) },
  { name: 'Jest 30', dir: dirname(require.resolve('jest/package.json')) },
] as const;

export type JestVersion = (typeof JEST_VERSIONS)[number];

/** A token that must never show up in any output. */
export const TOKEN = 'prb_test_T0KEN_must_never_leak_42';

export interface CommandRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Workspace {
  readonly dir: string;
  /** `jest <args>` in the workspace, with only `env` (plus PATH and HOME) around it. */
  jest(args: readonly string[], env?: Record<string, string>): Promise<CommandRun>;
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

/** `node <args>` in `cwd`, with only `env` (plus PATH and HOME) around it. */
export function runNode(
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
): Promise<CommandRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      // Nothing of the real environment (CI variables, PROBARA_*, JEST_*) leaks in.
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

export async function createWorkspace(jest: JestVersion): Promise<Workspace> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'probara-jest-')));
  await cp(FIXTURE_DIR, dir, { recursive: true });
  await mkdir(join(dir, 'node_modules', '@probara'), { recursive: true });
  const reporterDir = join(dir, 'node_modules', '@probara', 'jest-reporter');
  await mkdir(reporterDir);
  await cp(join(PACKAGE_DIR, 'package.json'), join(reporterDir, 'package.json'));
  await cp(join(PACKAGE_DIR, 'dist'), join(reporterDir, 'dist'), { recursive: true });
  await symlink(CORE_DIR, join(dir, 'node_modules', '@probara', 'core'));
  await symlink(JEST_JUNIT_DIR, join(dir, 'node_modules', 'jest-junit'));
  const jestBin = join(jest.dir, 'bin', 'jest.js');
  return {
    dir,
    jest: (args, env = {}) => runNode([jestBin, ...args], dir, env),
    probara: (args, env = {}) => runNode([CLI_BIN, ...args], dir, env),
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}
