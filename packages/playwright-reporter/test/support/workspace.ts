/**
 * A throwaway copy of the fixture project, laid out like a user's: `node_modules` holds a copy of
 * the built reporter (by its package name), `@probara/core` and `@playwright/test`. The reporter is
 * copied, not linked: `probara.*` imports `@playwright/test`, which must resolve to the project's
 * own (a link would resolve it from this package, a second Playwright). Commands run as child processes, without
 * blocking the event loop, so the fake Probara of the test can answer them.
 */
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isVersionAtLeast } from './version.js';

const require = createRequire(import.meta.url);
const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/project/', import.meta.url));
/**
 * The `@playwright/test` the project runs with: the devDependency, or the install folder in
 * `PROBARA_E2E_PLAYWRIGHT_DIR` (`<dir>/node_modules/@playwright/test`), to check the oldest version
 * of the peer range.
 */
const PLAYWRIGHT_DIR =
  process.env.PROBARA_E2E_PLAYWRIGHT_DIR === undefined
    ? dirname(require.resolve('@playwright/test/package.json'))
    : join(process.env.PROBARA_E2E_PLAYWRIGHT_DIR, 'node_modules', '@playwright', 'test');
const CLI_BIN = join(dirname(require.resolve('@probara/cli/package.json')), 'dist', 'cli.js');
const CORE_DIR = dirname(require.resolve('@probara/core/package.json'));

/** Whether the `@playwright/test` the project runs with is at least `major.minor`. */
export function playwrightAtLeast(major: number, minor: number): boolean {
  const manifest = require(join(PLAYWRIGHT_DIR, 'package.json')) as { version: string };
  return isVersionAtLeast(manifest.version, major, minor);
}

/** A token that must never show up in any output. */
export const TOKEN = 'prb_test_T0KEN_must_never_leak_42';

export interface CommandRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Workspace {
  readonly dir: string;
  /** `playwright <args>` in the workspace, with only `env` (plus PATH and HOME) around it. */
  playwright(args: readonly string[], env?: Record<string, string>): Promise<CommandRun>;
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
    PROBARA_PROJECT: 'PRB',
    PROBARA_BASE_URL: baseUrl,
    ...extra,
  };
}

function run(
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
): Promise<CommandRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      // Nothing of the real environment (CI variables, PROBARA_*) leaks in.
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

export async function createWorkspace(): Promise<Workspace> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'probara-playwright-')));
  await cp(FIXTURE_DIR, dir, { recursive: true });
  await mkdir(join(dir, 'node_modules', '@probara'), { recursive: true });
  await mkdir(join(dir, 'node_modules', '@playwright'), { recursive: true });
  const reporterDir = join(dir, 'node_modules', '@probara', 'playwright-reporter');
  await mkdir(reporterDir);
  await cp(join(PACKAGE_DIR, 'package.json'), join(reporterDir, 'package.json'));
  await cp(join(PACKAGE_DIR, 'dist'), join(reporterDir, 'dist'), { recursive: true });
  await symlink(CORE_DIR, join(dir, 'node_modules', '@probara', 'core'));
  await symlink(PLAYWRIGHT_DIR, join(dir, 'node_modules', '@playwright', 'test'));
  const playwrightCli = join(dir, 'node_modules', '@playwright', 'test', 'cli.js');
  return {
    dir,
    playwright: (args, env = {}) => run([playwrightCli, ...args], dir, env),
    probara: (args, env = {}) => run([CLI_BIN, ...args], dir, env),
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}
