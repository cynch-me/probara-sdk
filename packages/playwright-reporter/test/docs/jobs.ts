/**
 * Runs the command lines of a `bash`, `yaml` or `groovy` block of the docs like one CI job, in a
 * copy of the docs project: `playwright` and `probara` lines run for real, against the fake
 * Probara; installs and other commands are left out.
 *
 * - `export` and assignments carry over to later lines, and `$(...)` substitutes the stdout of a
 *   `probara` or `playwright` command. Azure macros (`$(System.JobPositionInPhase)`), `$((...))`
 *   and the shard matrix of GitHub Actions take the first shard's values.
 * - A line guarded by a file (`if [ -f probara-results.json ]; then ...; fi`) runs its command. A
 *   guarded file the job did not write is written first, by the docs project's tests with
 *   reporting off, so the command is checked whether or not an earlier line left the file.
 * - Run ULIDs a command names exist in Probara, so the fake knows them too.
 * - In CI files a run ULID reaches `probara run close` through the pipeline (job outputs,
 *   artifacts), which this does not model: a close with no ULID gets a seeded open run.
 * - `merge-reports` reads the blob reports of the docs project's tests, run as two shards into the
 *   folder it names.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FencedBlock } from '@probara/test-support/docs/markdown';
import {
  EXIT_ANNOTATION,
  fileGuardOf,
  logicalLines,
  parseLine,
  shellLineOf,
  splitAssignments,
} from '@probara/test-support/docs/shell';
import type { FakeProbara } from '@probara/test-support/fake-probara';
import type { Command } from './examples.js';
import { commandOf, expandArithmetic, expandCiExpressions, mentionsTool } from './examples.js';
import { docsEnv, type DocsWorkspace } from './runner.js';

/** What the CI of each guide gives the first of two shards. */
export const SHARD_ENV: Readonly<Record<string, string>> = {
  CI_NODE_INDEX: '1',
  CI_NODE_TOTAL: '2',
  CIRCLE_NODE_INDEX: '0',
  CIRCLE_NODE_TOTAL: '2',
  BUILDKITE_PARALLEL_JOB: '0',
  BUILDKITE_PARALLEL_JOB_COUNT: '2',
};

/** Azure Pipelines macros of a sharded job, `$(Name)`. */
const AZURE_MACROS: Readonly<Record<string, string>> = {
  'System.JobPositionInPhase': '1',
  'System.TotalJobsInPhase': '2',
};

export interface Invocation {
  /** 1-based line in the Markdown file. */
  line: number;
  text: string;
  expected: number;
  exitCode: number;
  output: string;
}

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

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** The run ULIDs a command names, by `--run-ulid` or `PROBARA_RUN_ULID`, as the fake's runs. */
function seedNamedRuns(command: Command, env: Record<string, string>, fake: FakeProbara): void {
  const seen = { ...env, ...Object.fromEntries(command.assignments) };
  const named: string[] = [];
  let project = seen.PROBARA_PROJECT ?? 'SHOP';
  command.args.forEach((arg, index) => {
    const next = command.args[index + 1] ?? '';
    if (arg === '--run-ulid') named.push(next);
    else if (arg.startsWith('--run-ulid=')) named.push(arg.slice('--run-ulid='.length));
    else if (arg === '--project') project = next;
  });
  if (seen.PROBARA_RUN_ULID !== undefined) named.push(seen.PROBARA_RUN_ULID);
  for (const ulid of named.map((value) => value.trim().toUpperCase())) {
    if (ULID.test(ulid) && fake.run(ulid) === undefined) fake.seedRun({ ulid, projectId: project });
  }
}

/** Runs every command line of `block` in order; see the module comment. */
export async function runJob(
  block: FencedBlock,
  { workspace, fake }: { workspace: DocsWorkspace; fake: FakeProbara },
): Promise<Invocation[]> {
  const env: Record<string, string> = { ...docsEnv(fake), ...SHARD_ENV };
  const invocations: Invocation[] = [];

  /** Runs `command` with the job's environment; its own assignments go with it. */
  async function invoke(command: Command) {
    seedNamedRuns(command, env, fake);
    const runEnv = { ...env };
    const seen = { ...env, ...Object.fromEntries(command.assignments) };
    if (command.kind === 'probara' && command.args[0] === 'run' && command.args[1] === 'close') {
      const named = command.args.some((arg) => arg.startsWith('--run-ulid'));
      if (!named && (seen.PROBARA_RUN_ULID ?? '').trim() === '') {
        const ulid = fake.seedRun({ projectId: seen.PROBARA_PROJECT ?? 'SHOP' });
        runEnv.PROBARA_RUN_ULID = ulid;
        command.assignments = command.assignments.filter(([name]) => name !== 'PROBARA_RUN_ULID');
      }
    }
    if (command.kind === 'playwright' && command.args[0] === 'merge-reports') {
      // The one positional argument: the folder of blob reports.
      const valued = new Set(['--reporter', '--config', '-c']);
      const folder =
        command.args
          .slice(1)
          .filter((arg, index, args) => !arg.startsWith('-') && !valued.has(args[index - 1] ?? ''))
          .at(-1) ?? 'blob-report';
      await writeBlobReports(workspace, folder, runEnv);
    }
    return workspace.run(command, runEnv);
  }

  /** `$(...)`: an Azure macro, or the stdout of a command the docs tests run. */
  const substitute = async (inner: string, line: number): Promise<string> => {
    const macro = AZURE_MACROS[inner.trim()];
    if (macro !== undefined) return macro;
    const command = await commandOf(inner, env);
    if (command.kind !== 'playwright' && command.kind !== 'probara') return '';
    const result = await invoke(command);
    invocations.push({
      line,
      text: inner,
      expected: 0,
      exitCode: result.exitCode,
      output: `${result.stdout}${result.stderr}`,
    });
    return result.stdout;
  };

  for (const { line, text } of logicalLines(block)) {
    const shell = shellLineOf(text);
    if (shell === undefined) continue;
    const isAssignment = /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=/.test(shell);
    // Other lines (YAML keys, env maps with secrets, echo...) are the CI's business.
    if (!mentionsTool(shell) && !isAssignment) continue;
    // YAML keys that are not commands (`name: probara`, `job: playwright`).
    if (/^[A-Za-z_][\w-]*:(?:\s|$)/.test(shell)) continue;
    const guard = fileGuardOf(text);
    if (guard !== undefined && !existsSync(join(workspace.dir, guard))) {
      await writeResultsFile(workspace, guard, env);
    }
    const expanded = expandArithmetic(expandCiExpressions(shell), env);
    const expected = Number(EXIT_ANNOTATION.exec(text)?.[1] ?? '0');
    // A command inside `$(...)` counts as run on this line.
    const before = invocations.length;

    const parsed = await parseLine(expanded, env, (inner) => substitute(inner, line));
    const words = parsed.words[0] === 'export' ? parsed.words.slice(1) : parsed.words;
    const { assignments, command: rest } = splitAssignments(words);
    if (rest.length === 0) {
      for (const [name, value] of assignments) {
        // The fake only accepts its own token.
        if (name !== 'PROBARA_API_TOKEN') env[name] = value;
      }
      continue;
    }
    const command = await commandOf(rest.map((word) => shellQuote(word)).join(' '), env);
    command.assignments = assignments;
    if (command.kind === 'install') continue;
    if (command.kind === 'other') {
      if (invocations.length === before && mentionsTool(expanded)) {
        throw new Error(
          `Line ${line} mentions a tool but runs no command the docs tests know: ${shell}`,
        );
      }
      continue;
    }
    const result = await invoke(command);
    invocations.push({
      line,
      text: shell,
      expected,
      exitCode: result.exitCode,
      output: `${result.stdout}${result.stderr}`,
    });
  }
  return invocations;
}

/** A word quoted for {@link commandOf}, which parses it again. */
function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}
