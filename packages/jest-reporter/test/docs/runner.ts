/**
 * Runs the examples of the docs: a throwaway copy of the docs project (`test/fixtures/docs/project`)
 * with the files of an example, laid out like a user's (`node_modules` holds the built reporter and
 * `@probara/core`), and the real `jest` (the default dev dependency, Jest 30) and `probara` bins in
 * it.
 *
 * - An example that brings its own config (`jest.config.mjs`, a `jest` key in `package.json`...)
 *   replaces the default `jest.config.js`: Jest refuses a project with two.
 * - Every command loads `@probara/test-support`'s `redirect-fetch.mjs`, so each request goes to the
 *   fake Probara of the test, whatever base URL the example names.
 * - `jest --watchAll` never exits on its own: {@link DocsWorkspace.watch} runs it as a session a
 *   user would, saving a test file for each re-run, then stops it.
 * - Every command of a workspace ends by its deadline ({@link DOCS_BUDGET_MS} after it was created,
 *   below the {@link DOCS_TEST_TIMEOUT_MS} a docs test gets): one still running then is killed, and fails with
 *   what it printed, so a hung `jest` never outlives its test and the test's cleanup still runs.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFile, cp, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { docsEnvOf, runEnvOf } from '@probara/test-support/docs/env';
import type { FakeProbara } from '@probara/test-support/fake-probara';
import {
  CLI_BIN,
  installPackages,
  JEST_VERSIONS,
  jestBinOf,
  runNode,
  TOKEN,
  type CommandRun,
} from '../support/workspace.js';
import { CONFIG_FILE, isTestFile, type Command, type DocProject } from './examples.js';

const DOCS_PROJECT = join(__dirname, '..', 'fixtures', 'docs', 'project');
/** Jest 30: the docs describe the current version. */
const JEST = JEST_VERSIONS[1];
const JEST_BIN = jestBinOf(JEST);

/** Whether the Jest config of `project` names its Probara project (`projectId`). */
function namesProject(project: DocProject | undefined): boolean {
  return [...(project?.files ?? [])].some(
    ([path, content]) => isOwnConfig(path, content) && /\bprojectId\b/.test(content),
  );
}

/**
 * The environment of a configured CI job, reporting to `fake` whatever the base URL. The job sets
 * `PROBARA_PROJECT`, unless the config of `project` names its project: the option alone must then
 * make the run report.
 */
export function docsEnv(
  fake: FakeProbara,
  extra: Record<string, string | undefined> = {},
  project?: DocProject,
): Record<string, string> {
  return docsEnvOf({
    token: TOKEN,
    fakeUrl: fake.baseUrl,
    project: namesProject(project) ? undefined : 'SHOP',
    extra,
  });
}

/** How a watch session goes: how many runs Jest makes, and what happens between two of them. */
export interface WatchPlan {
  /** The first run, then a re-run for each more. */
  runs: number;
  /** Called once run `ended` (1-based) finished, before the change that starts the next. */
  between?: (ended: number) => void | Promise<void>;
}

export interface DocsWorkspace {
  readonly dir: string;
  run(command: Command, env: Record<string, string>): Promise<CommandRun>;
  /**
   * `jest --watchAll` as a user runs it: Jest's first run, then a re-run each time a test file is
   * saved, `plan.runs` runs in all; then Jest is stopped. What it printed until then.
   */
  watch(command: Command, env: Record<string, string>, plan: WatchPlan): Promise<CommandRun>;
  remove(): Promise<void>;
}

/** Whether a `jest` command runs in watch mode (`--watch`, `--watchAll`): it never exits. */
export function isWatchCommand(command: Command): boolean {
  if (command.kind !== 'jest') return false;
  return command.args.some((arg) => {
    const [flag, value] = arg.split('=', 2);
    return (flag === '--watch' || flag === '--watchAll') && value !== 'false';
  });
}

/**
 * How long the commands of one workspace may take in all, its layout included: an example's run,
 * or a whole CI job of the command-line tests (its run create, every shard and the close).
 */
export const DOCS_BUDGET_MS = 100_000;
/**
 * The time a docs test gets for one workspace: its budget, and time left for the cleanup, so a
 * command that hangs fails with what it printed rather than with a bare test timeout.
 */
export const DOCS_TEST_TIMEOUT_MS = DOCS_BUDGET_MS + 20_000;
/** What Jest's summary prints at the end of every run, watch mode included. */
const RUN_ENDED = /^Ran all test suites/gm;
/** A save the watcher missed (it was not ready yet) is repeated after this long. */
const WATCH_NUDGE_MS = 10_000;

/** The test files under `dir` (outside `node_modules`), relative to it. */
async function testFilesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .filter((path) => !path.split('/').includes('node_modules') && isTestFile(path))
    .sort();
}

/** The first test file of the workspace in `dir`: the one a watch session saves. */
async function firstTestFile(dir: string): Promise<string> {
  const [first] = await testFilesUnder(dir);
  if (first === undefined) throw new Error('a watch session needs a test file to save');
  return join(dir, first);
}

/**
 * The exit code `jest` would give the last run of a session: 1 when a test or a test file of that
 * run failed, as in Jest's summary.
 */
function lastRunExitCode(stderr: string): number {
  const ends = [...stderr.matchAll(RUN_ENDED)].map((match) => match.index);
  const last = stderr.slice(ends.at(-2) ?? 0, ends.at(-1));
  return /^Test Suites:.*\bfailed\b|^Tests:.*\bfailed\b/m.test(last) ? 1 : 0;
}

/** A watch session: where it runs, the test file it saves, and until when it may run. */
export interface WatchSession {
  dir: string;
  file: string;
  args: readonly string[];
  env: Record<string, string>;
  plan: WatchPlan;
  /** When a session still short of its runs fails (`Date.now()` time). */
  deadline: number;
}

/**
 * Runs the watch session of {@link DocsWorkspace.watch}: `plan.runs` runs, saving `file` for each
 * re-run, all by `deadline`. Its exit code is the last run's.
 */
export async function watchSession({
  dir,
  file,
  args,
  env,
  plan,
  deadline,
}: WatchSession): Promise<CommandRun> {
  // Watchman may be missing where the docs tests run; Jest's own crawler sees the same saves.
  const flags = args.includes('--no-watchman') ? args : [...args, '--no-watchman'];
  const child: ChildProcess = spawn(process.execPath, [JEST_BIN, ...flags], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
  });
  let stdout = '';
  let stderr = '';
  let failed: Error | undefined;
  const exited = new Promise<void>((resolve) => {
    // A process that could not start emits `error`, and maybe no `close`; one that could not open
    // its pipes (EMFILE) has no stdout nor stderr either, so these listeners come first.
    child.on('error', (error) => {
      failed = error;
      resolve();
    });
    child.on('close', () => {
      resolve();
    });
  });
  child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const ended = () => stderr.match(RUN_ENDED)?.length ?? 0;
  const save = () => appendFile(file, '\n');
  try {
    for (let run = 1; run <= plan.runs; run += 1) {
      let nudged = Date.now();
      while (ended() < run) {
        if (failed !== undefined) throw failed;
        if (child.exitCode !== null) throw new Error(`jest exited in a watch session:\n${stderr}`);
        if (Date.now() > deadline) {
          throw new Error(
            `jest ended ${String(ended())} of ${String(plan.runs)} runs in time:\n${stderr}`,
          );
        }
        if (run > 1 && Date.now() - nudged > WATCH_NUDGE_MS) {
          nudged = Date.now();
          await save();
        }
        await delay(100);
      }
      if (run === plan.runs) break;
      await plan.between?.(run);
      // Give the watcher a moment before the save it must see.
      await delay(1_000);
      await save();
    }
  } finally {
    child.kill('SIGTERM');
    await exited;
  }
  return { exitCode: lastRunExitCode(stderr), stdout, stderr };
}

/** Whether a file of an example is a Jest config of its own. */
function isOwnConfig(path: string, content: string): boolean {
  if (/^jest\.config\.[cm]?[jt]s$/.test(path)) return true;
  if (path !== 'package.json') return false;
  try {
    const manifest = JSON.parse(content) as Record<string, unknown>;
    return manifest.jest !== undefined;
  } catch {
    return false;
  }
}

/** The docs project, the files of `project` and the packages, in `dir`. */
async function layOut(dir: string, project: DocProject | undefined): Promise<void> {
  await cp(DOCS_PROJECT, dir, { recursive: true });
  if (project?.ownTests === true) await rm(join(dir, 'tests'), { recursive: true, force: true });
  const files = [...(project?.files ?? [])];
  const ownConfig = files.some(([path, content]) => isOwnConfig(path, content));
  if (ownConfig && project?.files.has(CONFIG_FILE) !== true) await rm(join(dir, CONFIG_FILE));
  for (const [path, content] of files) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  await installPackages(dir, JEST);
}

/** The environment of `command`: the job's, with the variables the line assigns (`runEnvOf`). */
function runEnv(command: Command, env: Record<string, string>): Record<string, string> {
  return runEnvOf(command.assignments, env);
}

/**
 * A copy of the docs project with the files of `project` (its default tests unless it has its own),
 * in a new folder of `root`. Its commands end within `budgetMs` of now, or fail.
 */
export async function createDocsWorkspace(
  project?: DocProject,
  root = tmpdir(),
  budgetMs = DOCS_BUDGET_MS,
): Promise<DocsWorkspace> {
  const deadline = Date.now() + budgetMs;
  const dir = await realpath(await mkdtemp(join(root, 'probara-jest-docs-')));
  try {
    await layOut(dir, project);
  } catch (error) {
    // A workspace that cannot be set up is nobody's to remove: remove it here.
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    dir,
    run: (command, env) => {
      const bin = command.kind === 'jest' ? JEST_BIN : CLI_BIN;
      return runNode([bin, ...command.args], dir, runEnv(command, env), {
        timeoutMs: deadline - Date.now(),
      });
    },
    // The file is found first: a session that cannot save one never starts a `jest` to stop.
    watch: async (command, env, plan) =>
      watchSession({
        dir,
        file: await firstTestFile(dir),
        args: command.args,
        env: runEnv(command, env),
        plan,
        deadline,
      }),
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}
