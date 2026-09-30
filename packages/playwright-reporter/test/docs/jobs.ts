/**
 * Runs the command lines of a `bash`, `yaml` or `groovy` block of the docs like one CI job, in a
 * copy of the docs project: `playwright` and `probara` lines run for real, against the fake
 * Probara; installs and other commands are left out.
 *
 * - `export` and assignments carry over to later lines, and `$(...)` substitutes the stdout of a
 *   `probara` or `playwright` command. Azure macros (`$(System.JobPositionInPhase)`), `$((...))`
 *   and the shard matrix of GitHub Actions take the first shard's values.
 * - A line guarded by a file (`if [ -f probara-results.json ]; then ...; fi`) runs only when the
 *   file exists, like the shell would.
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
  probaraArgs,
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

/** Blob reports of the docs project's tests, as two shards, into `folder` of the workspace. */
async function writeBlobReports(
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

/** Runs every command line of `block` in order; see the module comment. */
export async function runJob(
  block: FencedBlock,
  { workspace, fake }: { workspace: DocsWorkspace; fake: FakeProbara },
): Promise<Invocation[]> {
  const env: Record<string, string> = { ...docsEnv(fake), ...SHARD_ENV };
  const invocations: Invocation[] = [];

  async function invoke(command: Command, lineEnv: Record<string, string>) {
    const runEnv = { ...lineEnv };
    if (command.kind === 'probara' && command.args[0] === 'run' && command.args[1] === 'close') {
      const named = command.args.some((arg) => arg.startsWith('--run-ulid'));
      if (!named && (runEnv.PROBARA_RUN_ULID ?? '').trim() === '') {
        runEnv.PROBARA_RUN_ULID = fake.seedRun({ projectId: runEnv.PROBARA_PROJECT ?? 'SHOP' });
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
    const result = await invoke(command, { ...env, ...Object.fromEntries(command.assignments) });
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
    const shell = shellLineOf(expandCiExpressions(text));
    if (shell === undefined) continue;
    const guard = fileGuardOf(
      text
        .trim()
        .replace(/^-\s+/, '')
        .replace(/^(?:run|script):\s*/, ''),
    );
    if (guard !== undefined && !existsSync(join(workspace.dir, guard))) continue;
    const expanded = expandArithmetic(shell, env);
    const isAssignment = /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=/.test(expanded);
    if (!mentionsTool(expanded) && !isAssignment) continue;
    const expected = Number(EXIT_ANNOTATION.exec(text)?.[1] ?? '0');

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
      if (mentionsTool(expanded) && probaraArgs(rest) === undefined) {
        throw new Error(
          `Line ${line} mentions a tool but runs no command the docs tests know: ${shell}`,
        );
      }
      continue;
    }
    const result = await invoke(command, { ...env, ...Object.fromEntries(assignments) });
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
