/**
 * Runs the command lines of a `bash`, `yaml` or `groovy` block of the docs like one CI job, in a
 * copy of a reporter's docs project: the test tool's lines and `probara` lines run for real,
 * against the fake Probara; installs and other commands are left out. The reporter's harness says
 * how a line becomes a command and runs it ({@link JobTool}).
 *
 * - `export` and assignments carry over to later lines, and `$(...)` substitutes the stdout of a
 *   command the harness runs. Azure macros (`$(System.JobPositionInPhase)`), `$((...))` and the
 *   shard matrix of GitHub Actions take the first shard's values.
 * - A line guarded by a file (`if [ -f probara-results.json ]; then ...; fi`) runs its command. A
 *   guarded file the job did not write is written first, by the docs project's tests with
 *   reporting off, so the command is checked whether or not an earlier line left the file.
 * - Likewise `probara import results` with paths or globs (`'probara-results*.json'`), before
 *   or after its flags: the file each names (a glob without its `*`) is written first when the job
 *   did not write it, so the import sends a real file rather than exiting 0 on no match.
 * - Run ULIDs a command names exist in Probara, so the fake knows them too.
 * - In CI files a run ULID reaches `probara run close` through the pipeline (job outputs,
 *   artifacts), which this does not model: a close with no ULID gets a seeded open run.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expandArithmetic, expandCiExpressions, type Command } from './examples.js';
import type { FencedBlock } from './markdown.js';
import {
  EXIT_ANNOTATION,
  fileGuardOf,
  logicalLines,
  parseLine,
  shellLineOf,
  splitAssignments,
} from './shell.js';
import type { FakeProbara } from '../fake-probara.js';

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

export interface CommandRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Invocation {
  /** 1-based line in the Markdown file. */
  line: number;
  text: string;
  expected: number;
  exitCode: number;
  output: string;
}

/** How a reporter's harness runs the lines of a job. */
export interface JobTool<C extends Command> {
  /** The folder the job runs in. */
  dir: string;
  fake: FakeProbara;
  /** The environment of a configured job. */
  env: Record<string, string>;
  /** What a command line runs, with its variables expanded from `env`. */
  commandOf(line: string, env: Readonly<Record<string, string | undefined>>): Promise<C>;
  /** Whether a line runs the test tool or the `probara` CLI, even inside `$(...)`. */
  mentionsTool(line: string): boolean;
  /** Whether a command is one the job runs (the test tool or `probara`). */
  runs(command: C): boolean;
  /** Writes a results file at `path` of the folder: the docs project's tests, reporting off. */
  writeResultsFile(path: string, env: Record<string, string>): Promise<void>;
  /** Anything a command needs first, such as the blob reports `merge-reports` reads. */
  prepare?(command: C, env: Record<string, string>): Promise<void>;
  run(command: C, env: Record<string, string>): Promise<CommandRun>;
  /** The flags of `probara import results` that take a value (`--run-name Nightly`). */
  valuedImportFlags: ReadonlySet<string>;
}

/** The flags of `probara import results` that take a value, from the CLI's option registry. */
export function valuedImportFlagsOf(
  options: readonly { name: string; short?: string; type: string; commands: readonly string[] }[],
): ReadonlySet<string> {
  return new Set(
    options
      .filter((spec) => spec.commands.includes('import results') && spec.type !== 'boolean')
      .flatMap((spec) => [
        `--${spec.name}`,
        ...(spec.short === undefined ? [] : [`-${spec.short}`]),
      ]),
  );
}

/**
 * The paths and globs of `probara import results <args>`: every argument but the flags and the
 * values of those that take one; everything after `--`.
 */
export function importResultsPaths(
  args: readonly string[],
  valuedFlags: ReadonlySet<string>,
): string[] {
  const paths: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--') {
      paths.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith('-')) paths.push(arg);
    else if (valuedFlags.has(arg)) index += 1;
  }
  return paths;
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

/** A word quoted for `commandOf`, which parses it again. */
function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/** Runs every command line of `block` in order; see the module comment. */
export async function runJobWith<C extends Command>(
  block: FencedBlock,
  tool: JobTool<C>,
): Promise<Invocation[]> {
  const { fake } = tool;
  const env: Record<string, string> = { ...tool.env, ...SHARD_ENV };
  const invocations: Invocation[] = [];

  /** Runs `command` with the job's environment; its own assignments go with it. */
  async function invoke(command: C) {
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
    if (
      command.kind === 'probara' &&
      command.args[0] === 'import' &&
      command.args[1] === 'results'
    ) {
      for (const pattern of importResultsPaths(command.args.slice(2), tool.valuedImportFlags)) {
        const file = pattern.replace(/\*/g, '');
        if (!existsSync(join(tool.dir, file))) await tool.writeResultsFile(file, runEnv);
      }
    }
    await tool.prepare?.(command, runEnv);
    return tool.run(command, runEnv);
  }

  /** `$(...)`: an Azure macro, or the stdout of a command the docs tests run. */
  const substitute = async (inner: string, line: number): Promise<string> => {
    const macro = AZURE_MACROS[inner.trim()];
    if (macro !== undefined) return macro;
    const command = await tool.commandOf(inner, env);
    if (!tool.runs(command)) return '';
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
    if (!tool.mentionsTool(shell) && !isAssignment) continue;
    // YAML keys that are not commands (`name: probara`, `job: playwright`).
    if (/^[A-Za-z_][\w-]*:(?:\s|$)/.test(shell)) continue;
    const guard = fileGuardOf(text);
    if (guard !== undefined && !existsSync(join(tool.dir, guard))) {
      await tool.writeResultsFile(guard, env);
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
    const command = await tool.commandOf(rest.map((word) => shellQuote(word)).join(' '), env);
    command.assignments = assignments;
    if (command.kind === 'install') continue;
    if (!tool.runs(command)) {
      if (invocations.length === before && tool.mentionsTool(expanded)) {
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
