/**
 * Runs the command lines of a `bash`, `yaml` or `groovy` block of the docs like one CI job, in a
 * copy of the docs project (`@probara/test-support/docs/jobs` says how): `playwright` and `probara`
 * lines run for real, against the fake Probara.
 *
 * - A guarded file or a results file `probara import results` names is written by the docs
 *   project's tests, run with reporting off.
 * - `merge-reports` reads the blob reports of the docs project's tests, run as two shards into the
 *   folder it names.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  importResultsPaths as pathsOf,
  runJobWith,
  valuedImportFlagsOf,
  type Invocation,
} from '@probara/test-support/docs/jobs';
import type { FencedBlock } from '@probara/test-support/docs/markdown';
import type { FakeProbara } from '@probara/test-support/fake-probara';
import { commandOf, mentionsTool } from './examples.js';
import { CLI_BIN } from '../support/workspace.js';
import { docsEnv, type DocsWorkspace } from './runner.js';

export { SHARD_ENV, type Invocation } from '@probara/test-support/docs/jobs';

/** Blob reports of the workspace's tests, as two shards, into `folder` of the workspace. */
export async function writeBlobReports(
  workspace: DocsWorkspace,
  folder: string,
  env: Record<string, string>,
): Promise<void> {
  for (const shard of ['1/2', '2/2']) {
    const run = await workspace.run(
      {
        kind: 'playwright',
        args: ['test', `--shard=${shard}`, '--reporter=blob'],
        assignments: [],
      },
      { ...env, PLAYWRIGHT_BLOB_OUTPUT_DIR: folder, PWTEST_BLOB_DO_NOT_REMOVE: '1' },
    );
    if (run.exitCode !== 0) throw new Error(`could not write the blob reports: ${run.stderr}`);
  }
}

/** A results file at `path` of the workspace: its tests, run with reporting off. */
async function writeResultsFile(
  workspace: DocsWorkspace,
  path: string,
  env: Record<string, string>,
): Promise<void> {
  const run = await workspace.run(
    { kind: 'playwright', args: ['test'], assignments: [] },
    { ...env, PROBARA_ENABLED: 'false', PROBARA_RESULTS_FILE: path },
  );
  if (!existsSync(join(workspace.dir, path))) {
    throw new Error(`could not write ${path}: ${run.stderr}`);
  }
}

/** An option of the CLI's registry (`@probara/cli`'s `src/options.ts`), as this reads it. */
interface CliOption {
  name: string;
  short?: string;
  type: string;
  commands: readonly string[];
}

const { OPTIONS } = (await import(pathToFileURL(join(dirname(CLI_BIN), 'options.js')).href)) as {
  OPTIONS: readonly CliOption[];
};

/** The flags of `probara import results` that take a value (`--run-name Nightly`). */
const VALUED_FLAGS = valuedImportFlagsOf(OPTIONS);

/**
 * The paths and globs of `probara import results <args>`: every argument but the flags and the
 * values of those that take one; everything after `--`.
 */
export function importResultsPaths(args: readonly string[]): string[] {
  return pathsOf(args, VALUED_FLAGS);
}

/** Runs every command line of `block` in order; see the module comment. */
export function runJob(
  block: FencedBlock,
  { workspace, fake }: { workspace: DocsWorkspace; fake: FakeProbara },
): Promise<Invocation[]> {
  return runJobWith(block, {
    dir: workspace.dir,
    fake,
    env: docsEnv(fake),
    commandOf,
    mentionsTool,
    runs: (command) => command.kind === 'playwright' || command.kind === 'probara',
    writeResultsFile: (path, env) => writeResultsFile(workspace, path, env),
    prepare: async (command, env) => {
      if (command.kind !== 'playwright' || command.args[0] !== 'merge-reports') return;
      // The one positional argument: the folder of blob reports.
      const valued = new Set(['--reporter', '--config', '-c']);
      const folder =
        command.args
          .slice(1)
          .filter((arg, index, args) => !arg.startsWith('-') && !valued.has(args[index - 1] ?? ''))
          .at(-1) ?? 'blob-report';
      await writeBlobReports(workspace, folder, env);
    },
    run: (command, env) => workspace.run(command, env),
    valuedImportFlags: VALUED_FLAGS,
  });
}
