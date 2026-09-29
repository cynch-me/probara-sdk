/**
 * The one registry of command-line options: it drives parsing, the `--help` of every command and
 * the options table of the docs. Options that map to core become core options; core reads the
 * environment itself, so the precedence (flags > `PROBARA_*` > CI detection > defaults) is core's.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ProbaraOptions } from '@probara/core';
import { JUNIT_DIALECTS } from './junit/dialects.js';

export type CommandName = 'import junit' | 'run create' | 'run close';

export type OptionType = 'boolean' | 'string' | 'integer' | 'list';

/** The core option a flag sets, as a path into {@link ProbaraOptions}. */
export type CoreOption =
  | 'projectId'
  | 'baseUrl'
  | 'run.ulid'
  | 'run.name'
  | 'run.environmentId'
  | 'run.milestoneId'
  | 'run.configurationUlids'
  | 'run.tags'
  | 'source'
  | 'source.branch'
  | 'source.commit'
  | 'source.buildUrl'
  | 'createMissingCases'
  | 'suiteUlid'
  | 'closeRun'
  | 'uploadAttachments'
  | 'rootDir'
  | 'timeoutMs'
  | 'maxRetries'
  | 'chunkSize'
  | 'attachmentConcurrency'
  | 'debug';

export interface OptionSpec {
  /** The long flag without its dashes: `project` is `--project`. */
  readonly name: string;
  /** A one-letter alias: `h` is `-h`. */
  readonly short?: string;
  /** `list` options repeat (`--tag a --tag b`) and take comma-separated values (`--tag a,b`). */
  readonly type: OptionType;
  /** How the value is shown in the help: `<code>`. */
  readonly value?: string;
  /** Booleans only: `both` accepts `--x` and `--no-x`; `only` accepts `--no-x` alone. */
  readonly negation?: 'both' | 'only';
  /** The values a string option accepts. */
  readonly choices?: readonly string[];
  /** The core option it sets; none for an option of the CLI itself. */
  readonly core?: CoreOption;
  /** The variable core reads for the same setting; none when the option has no variable. */
  readonly env?: string;
  /** The default, as the help and the docs show it. */
  readonly default?: string;
  readonly description: string;
  readonly commands: readonly CommandName[];
}

const IMPORT: readonly CommandName[] = ['import junit'];
/** Options of a new run: an import creates one unless it reuses one. */
const NEW_RUN: readonly CommandName[] = ['import junit', 'run create'];
const EXISTING_RUN: readonly CommandName[] = ['import junit', 'run close'];
const EVERY_COMMAND: readonly CommandName[] = ['import junit', 'run create', 'run close'];

export const OPTIONS: readonly OptionSpec[] = [
  {
    name: 'project',
    type: 'string',
    value: '<code>',
    core: 'projectId',
    env: 'PROBARA_PROJECT',
    description: 'Project code, such as SHOP',
    commands: EVERY_COMMAND,
  },
  {
    name: 'base-url',
    type: 'string',
    value: '<url>',
    core: 'baseUrl',
    env: 'PROBARA_BASE_URL',
    default: 'https://app.probara.net',
    description: 'Probara URL',
    commands: EVERY_COMMAND,
  },
  {
    name: 'run-ulid',
    type: 'string',
    value: '<ulid>',
    core: 'run.ulid',
    env: 'PROBARA_RUN_ULID',
    description: 'An existing run: import into it instead of creating one, or close it',
    commands: EXISTING_RUN,
  },
  {
    name: 'run-name',
    type: 'string',
    value: '<name>',
    core: 'run.name',
    env: 'PROBARA_RUN_NAME',
    default: 'the CI build name, else "Automated run <date> UTC"',
    description: 'Name of a new run',
    commands: NEW_RUN,
  },
  {
    name: 'environment-id',
    type: 'string',
    value: '<ulid>',
    core: 'run.environmentId',
    env: 'PROBARA_ENVIRONMENT_ID',
    description: 'Environment of a new run',
    commands: NEW_RUN,
  },
  {
    name: 'milestone-id',
    type: 'string',
    value: '<ulid>',
    core: 'run.milestoneId',
    env: 'PROBARA_MILESTONE_ID',
    description: 'Milestone of a new run',
    commands: NEW_RUN,
  },
  {
    name: 'configuration',
    type: 'list',
    value: '<ulid>',
    core: 'run.configurationUlids',
    env: 'PROBARA_CONFIGURATION_ULIDS',
    description: 'Configuration of a new run',
    commands: NEW_RUN,
  },
  {
    name: 'tag',
    type: 'list',
    value: '<tag>',
    core: 'run.tags',
    env: 'PROBARA_RUN_TAGS',
    description: 'Tag of a new run',
    commands: NEW_RUN,
  },
  {
    name: 'branch',
    type: 'string',
    value: '<name>',
    core: 'source.branch',
    env: 'PROBARA_BRANCH',
    default: 'detected from the CI',
    description: 'Branch of the run source',
    commands: NEW_RUN,
  },
  {
    name: 'commit',
    type: 'string',
    value: '<sha>',
    core: 'source.commit',
    env: 'PROBARA_COMMIT',
    default: 'detected from the CI',
    description: 'Commit of the run source',
    commands: NEW_RUN,
  },
  {
    name: 'build-url',
    type: 'string',
    value: '<url>',
    core: 'source.buildUrl',
    env: 'PROBARA_BUILD_URL',
    default: 'detected from the CI',
    description: 'CI build URL of the run source',
    commands: NEW_RUN,
  },
  {
    name: 'source',
    type: 'boolean',
    negation: 'only',
    core: 'source',
    description: 'Send no run source (branch, commit, build URL)',
    commands: NEW_RUN,
  },
  {
    name: 'create-missing-cases',
    type: 'boolean',
    negation: 'both',
    core: 'createMissingCases',
    env: 'PROBARA_CREATE_MISSING_CASES',
    default: 'true',
    description: 'Create a case for a test that matches none',
    commands: IMPORT,
  },
  {
    name: 'suite-ulid',
    type: 'string',
    value: '<ulid>',
    core: 'suiteUlid',
    env: 'PROBARA_SUITE_ULID',
    default: 'the project root',
    description: 'Suite that created cases go under',
    commands: IMPORT,
  },
  {
    name: 'close-run',
    type: 'boolean',
    negation: 'both',
    core: 'closeRun',
    env: 'PROBARA_CLOSE_RUN',
    default: 'true for a new run, false for an existing one (--run-ulid)',
    description: 'Close the run after the import',
    commands: IMPORT,
  },
  {
    name: 'attachments',
    type: 'boolean',
    negation: 'both',
    core: 'uploadAttachments',
    env: 'PROBARA_UPLOAD_ATTACHMENTS',
    default: 'true',
    description: 'Upload the files the reports reference',
    commands: IMPORT,
  },
  {
    name: 'attach-output',
    type: 'boolean',
    description: "Also attach each testcase's system-out and system-err as text files",
    commands: IMPORT,
  },
  {
    name: 'dialect',
    type: 'string',
    value: '<name>',
    choices: ['auto', ...JUNIT_DIALECTS],
    default: 'auto',
    description: 'JUnit dialect of every file, instead of detecting it per file',
    commands: IMPORT,
  },
  {
    name: 'error-status',
    type: 'string',
    value: '<status>',
    choices: ['failed', 'blocked'],
    default: 'failed',
    description: 'Status of a testcase with an <error>',
    commands: IMPORT,
  },
  {
    name: 'root-dir',
    type: 'string',
    value: '<dir>',
    core: 'rootDir',
    default: 'the current directory',
    description: 'Directory the file paths of automation keys are relative to',
    commands: IMPORT,
  },
  {
    name: 'fail-on-failed-tests',
    type: 'boolean',
    description: 'Exit 3 when a test failed or was blocked',
    commands: IMPORT,
  },
  {
    name: 'dry-run',
    type: 'boolean',
    description: 'Print what would be sent, and send nothing (no token needed)',
    commands: IMPORT,
  },
  {
    name: 'timeout',
    type: 'integer',
    value: '<ms>',
    core: 'timeoutMs',
    default: '30000',
    description: 'Timeout of one HTTP attempt, in milliseconds',
    commands: EVERY_COMMAND,
  },
  {
    name: 'max-retries',
    type: 'integer',
    value: '<n>',
    core: 'maxRetries',
    default: '4',
    description: 'Retries of a failed request, 0 to 10',
    commands: EVERY_COMMAND,
  },
  {
    name: 'chunk-size',
    type: 'integer',
    value: '<n>',
    core: 'chunkSize',
    default: '500',
    description: 'Results per report request, 1 to 500',
    commands: IMPORT,
  },
  {
    name: 'attachment-concurrency',
    type: 'integer',
    value: '<n>',
    core: 'attachmentConcurrency',
    default: '2',
    description: 'Results whose attachments upload at the same time, 1 to 8',
    commands: IMPORT,
  },
  {
    name: 'json',
    type: 'boolean',
    description: 'Print a JSON summary on stdout',
    commands: EVERY_COMMAND,
  },
  {
    name: 'debug',
    type: 'boolean',
    core: 'debug',
    env: 'PROBARA_DEBUG',
    default: 'false',
    description: 'Log every request',
    commands: EVERY_COMMAND,
  },
  {
    name: 'help',
    short: 'h',
    type: 'boolean',
    description: 'Show this help',
    commands: EVERY_COMMAND,
  },
];

/** The options of one command, in registry order. */
export function optionsOf(command: CommandName): OptionSpec[] {
  return OPTIONS.filter((option) => option.commands.includes(command));
}

/** A command line that cannot run: exit 2, with a pointer to the help of `helpCommand`. */
export class UsageError extends Error {
  override readonly name = 'UsageError';

  constructor(
    message: string,
    /** The command whose `--help` explains the fix, such as `probara import junit`. */
    readonly helpCommand: string,
  ) {
    super(message);
  }
}

export type OptionValue = boolean | string | number | string[];

export interface ParsedCommandLine {
  /** Only the options given, by name. */
  values: ReadonlyMap<string, OptionValue>;
  positionals: string[];
}

const TOKEN_FLAGS: ReadonlySet<string> = new Set(['--token', '--api-token']);

/** The arguments before `--`, where options live. */
function optionArgs(args: readonly string[]): readonly string[] {
  const end = args.indexOf('--');
  return end === -1 ? args : args.slice(0, end);
}

/** Whether `-h` or `--help` is among the options: the help wins over everything else. */
export function wantsHelp(args: readonly string[]): boolean {
  return optionArgs(args).some((arg) => arg === '-h' || arg === '--help');
}

function listValues(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * Parses the arguments of `command` against its options (`--x`, `--x=v`, `--x v`, `--no-x`).
 *
 * @throws UsageError on an unknown option, a missing or invalid value, or a `--token`.
 */
export function parseCommandLine(command: CommandName, args: readonly string[]): ParsedCommandLine {
  const helpCommand = `probara ${command}`;
  for (const arg of optionArgs(args)) {
    // The value is never echoed: it is a secret.
    if (TOKEN_FLAGS.has(arg.split('=')[0] ?? '')) {
      throw new UsageError(
        'There is no --token option: set the API token in the PROBARA_API_TOKEN variable (a command line shows up in process lists and CI logs)',
        helpCommand,
      );
    }
  }

  const specs = optionsOf(command);
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const { tokens } = parseArgs({
    args: [...args],
    options: Object.fromEntries(
      specs.map((spec) => [
        spec.name,
        {
          type: spec.type === 'boolean' ? 'boolean' : 'string',
          ...(spec.type === 'list' ? { multiple: true } : {}),
          ...(spec.short === undefined ? {} : { short: spec.short }),
        } as const,
      ]),
    ),
    strict: false,
    allowPositionals: true,
    allowNegative: true,
    tokens: true,
  });

  const values = new Map<string, OptionValue>();
  const positionals: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'positional') positionals.push(token.value);
    if (token.kind !== 'option') continue;

    const { rawName } = token;
    const negated = rawName.startsWith('--no-');
    // A known short option comes with its long name.
    const spec = byName.get(token.name);
    const unknown =
      spec === undefined ||
      (negated && spec.negation === undefined) ||
      (!negated && spec.negation === 'only');
    if (unknown) throw new UsageError(`Unknown option '${rawName}'`, helpCommand);

    const flag = `--${spec.name}`;
    if (spec.type === 'boolean') {
      if (token.value !== undefined) throw new UsageError(`${flag} takes no value`, helpCommand);
      values.set(spec.name, !negated);
      continue;
    }
    const { value } = token;
    // Without `=`, a value that looks like an option is the next option, not this one's value.
    if (value === undefined || (!token.inlineValue && value.startsWith('-'))) {
      throw new UsageError(`${flag} needs a value`, helpCommand);
    }
    if (spec.type === 'integer') {
      if (!/^\d+$/.test(value.trim())) {
        throw new UsageError(`${flag} must be a whole number`, helpCommand);
      }
      values.set(spec.name, Number(value.trim()));
    } else if (spec.type === 'list') {
      const previous = values.get(spec.name);
      values.set(spec.name, [...(Array.isArray(previous) ? previous : []), ...listValues(value)]);
    } else {
      if (spec.choices !== undefined && !spec.choices.includes(value)) {
        throw new UsageError(`${flag} must be one of ${spec.choices.join(', ')}`, helpCommand);
      }
      values.set(spec.name, value);
    }
  }
  return { values, positionals };
}

/** A string value of `values`, when given. */
export function stringOf(
  values: ReadonlyMap<string, OptionValue>,
  name: string,
): string | undefined {
  const value = values.get(name);
  return typeof value === 'string' ? value : undefined;
}

/**
 * The core options of the flags given: only those given, so an unset flag never hides its
 * variable. `rootDir` is resolved against `cwd`.
 */
export function toCoreOptions(
  command: CommandName,
  values: ReadonlyMap<string, OptionValue>,
  cwd: string,
): ProbaraOptions {
  const options: Record<string, unknown> = {};
  const run: Record<string, unknown> = {};
  const source: Record<string, unknown> = {};
  for (const spec of optionsOf(command)) {
    const value = values.get(spec.name);
    if (spec.core === undefined || value === undefined) continue;
    const [group, field] = spec.core.split('.');
    if (group === 'run' && field !== undefined) run[field] = value;
    else if (group === 'source' && field !== undefined) source[field] = value;
    else if (spec.core === 'rootDir') options.rootDir = resolve(cwd, String(value));
    else options[spec.core] = value;
  }
  if (Object.keys(run).length > 0) options.run = run;
  // `--no-source` wins over the source flags.
  if (options.source !== false && Object.keys(source).length > 0) options.source = source;
  return options;
}
