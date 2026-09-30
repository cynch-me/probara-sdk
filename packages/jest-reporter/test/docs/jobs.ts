/**
 * Runs the command lines of a `bash`, `yaml` or `groovy` block of the docs like one CI job, in a
 * copy of the docs project (`@probara/test-support/docs/jobs` says how): `jest` (`npm test`
 * included) and `probara` lines run for real, against the fake Probara, `--shard` included. A
 * guarded file or a results file `probara import results` names is written by the docs project's
 * tests, run with reporting off.
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
import { CLI_BIN } from '../support/workspace.js';
import { commandOf, mentionsTool } from './examples.js';
import { docsEnv, type DocsWorkspace } from './runner.js';

export type { Invocation } from '@probara/test-support/docs/jobs';

/** An option of the CLI's registry (`@probara/cli`'s `src/options.ts`), as this reads it. */
interface CliOption {
  name: string;
  short?: string;
  type: string;
  commands: readonly string[];
}

let valuedFlags: Promise<ReadonlySet<string>> | undefined;

/** The flags of `probara import results` that take a value, from the built CLI's registry. */
function valuedImportFlags(): Promise<ReadonlySet<string>> {
  valuedFlags ??= import(pathToFileURL(join(dirname(CLI_BIN), 'options.js')).href).then(
    (module: { OPTIONS: readonly CliOption[] }) => valuedImportFlagsOf(module.OPTIONS),
  );
  return valuedFlags;
}

/**
 * The paths and globs of `probara import results <args>`: every argument but the flags and the
 * values of those that take one; everything after `--`.
 */
export async function importResultsPaths(args: readonly string[]): Promise<string[]> {
  return pathsOf(args, await valuedImportFlags());
}

/** A results file at `path` of the workspace: its tests, run with reporting off. */
async function writeResultsFile(
  workspace: DocsWorkspace,
  path: string,
  env: Record<string, string>,
): Promise<void> {
  const run = await workspace.run(
    { kind: 'jest', args: [], assignments: [] },
    { ...env, PROBARA_ENABLED: 'false', PROBARA_RESULTS_FILE: path },
  );
  if (!existsSync(join(workspace.dir, path))) {
    throw new Error(`could not write ${path}: ${run.stderr}`);
  }
}

/** Runs every command line of `block` in order, like one CI job. */
export async function runJob(
  block: FencedBlock,
  { workspace, fake }: { workspace: DocsWorkspace; fake: FakeProbara },
): Promise<Invocation[]> {
  return runJobWith(block, {
    dir: workspace.dir,
    fake,
    env: docsEnv(fake),
    commandOf,
    mentionsTool,
    runs: (command) => command.kind === 'jest' || command.kind === 'probara',
    writeResultsFile: (path, env) => writeResultsFile(workspace, path, env),
    run: (command, env) => workspace.run(command, env),
    valuedImportFlags: await valuedImportFlags(),
  });
}
