/**
 * A throwaway Cucumber project, laid out as a user's is: `node_modules` holds `@cucumber/cucumber`
 * next to the formatter and `@probara/core`. Cucumber-js loads a formatter by its package name from
 * its own install, so the install is a real directory with its dependencies beside it (as pnpm lays
 * them out), not a link into this repository. Commands run as child processes, without blocking the
 * event loop, so the fake Probara of a test can answer them.
 */
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
/** The package under test: its `dist/` is copied into each project. */
export const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const CORE_DIR = dirname(require.resolve('@probara/core/package.json'));
export const CLI_BIN = join(
  dirname(require.resolve('@probara/cli/package.json')),
  'dist',
  'cli.js',
);
/** The `@cucumber/cucumber` this package is tested with, at its path in pnpm's store. */
const CUCUMBER_MANIFEST = require.resolve('@cucumber/cucumber/package.json');

/** A token that must never show up in any output. */
export const TOKEN = 'prb_test_T0KEN_must_never_leak_42';

export interface CommandRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Workspace {
  readonly dir: string;
  /** `cucumber-js <args>` in the project, with only `env` (plus PATH and HOME) around it. */
  cucumber(args: readonly string[], env?: Record<string, string>): Promise<CommandRun>;
  /** The built `probara` bin, in the project. */
  probara(args: readonly string[], env?: Record<string, string>): Promise<CommandRun>;
  remove(): Promise<void>;
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

/**
 * Copies `@cucumber/cucumber` into `nodeModules` as a directory, and links each of its dependencies
 * beside it, from the store where pnpm keeps them. Cucumber then resolves a formatter by name from
 * this project, as it does in a user's project.
 */
async function installCucumber(nodeModules: string): Promise<void> {
  const cucumberDir = dirname(await realpath(CUCUMBER_MANIFEST));
  const siblings = dirname(dirname(cucumberDir));
  await mkdir(join(nodeModules, '@cucumber'), { recursive: true });
  await cp(cucumberDir, join(nodeModules, '@cucumber', 'cucumber'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(cucumberDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    await mkdir(dirname(join(nodeModules, name)), { recursive: true });
    await symlink(join(siblings, name), join(nodeModules, name));
  }
}

/** A project with `files` (path → content, relative to the project), and the formatter installed. */
export async function createWorkspace(files: Record<string, string>): Promise<Workspace> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'probara-cucumber-')));
  const nodeModules = join(dir, 'node_modules');
  await installCucumber(nodeModules);
  const reporterDir = join(nodeModules, '@probara', 'cucumber-reporter');
  await mkdir(reporterDir, { recursive: true });
  await cp(join(PACKAGE_DIR, 'package.json'), join(reporterDir, 'package.json'));
  await cp(join(PACKAGE_DIR, 'dist'), join(reporterDir, 'dist'), { recursive: true });
  await symlink(CORE_DIR, join(nodeModules, '@probara', 'core'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  const cucumberBin = join(nodeModules, '@cucumber', 'cucumber', 'bin', 'cucumber.js');
  return {
    dir,
    cucumber: (args, env = {}) => runNode([cucumberBin, ...args], dir, env),
    probara: (args, env = {}) => runNode([CLI_BIN, ...args], dir, env),
    remove: () => rm(dir, { recursive: true, force: true }),
  };
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
