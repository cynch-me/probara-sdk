/**
 * The one registry of command-line options: it drives parsing, the `--help` of every command and
 * the options table of the docs. Options that map to core become core options; core reads the
 * environment itself, so the precedence (flags > `PROBARA_*` > CI detection > defaults) is core's.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ProbaraOptions } from '@probara/core';
import { FAILS_ON_TESTS } from './exit-codes.js';
import { JUNIT_DIALECTS } from './junit/dialects.js';

export type CommandName = 'import junit' | 'import results' | 'run create' | 'run close';

export type OptionType = 'boolean' | 'string' | 'integer' | 'list';

/** The core option a flag sets, as a path into {@link ProbaraOptions}. */
export type CoreOption =
  | 'projectId'
  | 'projects'
  | 'baseUrl'
  | 'run.ulid'
  | 'run.ulids'
  | 'run.name'
  | 'run.description'
  | 'run.environmentId'
  | 'run.environment'
  | 'run.milestoneId'
  | 'run.milestone'
  | 'run.plan'
  | 'run.configurationUlids'
  | 'run.configurations'
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
  | 'resultsFile'
  | 'timeoutMs'
  | 'maxRetries'
  | 'chunkSize'
  | 'attachmentConcurrency'
  | 'statusMapping'
  | 'statusFilter'
  | 'assignFailedTo'
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
  /** What the option also means for one command, appended to its description there. */
  readonly commandDetails?: Readonly<Partial<Record<CommandName, string>>>;
  readonly commands: readonly CommandName[];
}

/** Options of the JUnit import alone. */
const IMPORT: readonly CommandName[] = ['import junit'];
/** Options of both imports: results are sent. */
const IMPORTS: readonly CommandName[] = ['import junit', 'import results'];
/** Options of a new run: an import creates one unless it reuses one. */
const NEW_RUN: readonly CommandName[] = [...IMPORTS, 'run create'];
const EXISTING_RUN: readonly CommandName[] = [...IMPORTS, 'run close'];
const EVERY_COMMAND: readonly CommandName[] = [...IMPORTS, 'run create', 'run close'];

export const OPTIONS: readonly OptionSpec[] = [
  {
    name: 'project',
    type: 'string',
    value: '<code>',
    core: 'projectId',
    env: 'PROBARA_PROJECT',
    description: 'Project code, such as SHOP',
    commandDetails: { 'import junit': 'case ids in test names use it' },
    commands: EVERY_COMMAND,
  },
  {
    name: 'projects',
    type: 'list',
    value: '<code>',
    core: 'projects',
    env: 'PROBARA_PROJECTS',
    description: 'Another project whose cases results may go to, each in its own run',
    commands: IMPORTS,
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
    name: 'run-ulids',
    type: 'list',
    value: '<code=ulid>',
    core: 'run.ulids',
    env: 'PROBARA_RUN_ULIDS',
    description: 'An existing run of a project to import into, such as WEB=<ulid>',
    commands: IMPORTS,
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
    name: 'run-description',
    type: 'string',
    value: '<text>',
    core: 'run.description',
    env: 'PROBARA_RUN_DESCRIPTION',
    description: 'Description of a new run',
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
    name: 'environment',
    type: 'string',
    value: '<name>',
    core: 'run.environment',
    env: 'PROBARA_ENVIRONMENT',
    description: 'Environment of a new run by name',
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
    name: 'milestone',
    type: 'string',
    value: '<ref>',
    core: 'run.milestone',
    env: 'PROBARA_MILESTONE',
    description: 'Milestone of a new run by display id (M-3) or name',
    commands: NEW_RUN,
  },
  {
    name: 'plan',
    type: 'string',
    value: '<ref>',
    core: 'run.plan',
    env: 'PROBARA_PLAN',
    description: 'Test plan of a new run by display id (PLAN-2) or name',
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
    name: 'configuration-value',
    type: 'list',
    value: '<pair>',
    core: 'run.configurations',
    env: 'PROBARA_CONFIGURATIONS',
    description: 'Configuration of a new run by name, such as Browser=Chrome',
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
    commands: IMPORTS,
  },
  {
    name: 'suite-ulid',
    type: 'string',
    value: '<ulid>',
    core: 'suiteUlid',
    env: 'PROBARA_SUITE_ULID',
    default: 'the project root',
    description: 'Suite that created cases go under',
    commands: IMPORTS,
  },
  {
    name: 'close-run',
    type: 'boolean',
    negation: 'both',
    core: 'closeRun',
    env: 'PROBARA_CLOSE_RUN',
    default: 'true for a new run, false for an existing one (--run-ulid)',
    description: 'Close the run after the import',
    commands: IMPORTS,
  },
  {
    name: 'attachments',
    type: 'boolean',
    negation: 'both',
    core: 'uploadAttachments',
    env: 'PROBARA_UPLOAD_ATTACHMENTS',
    default: 'true',
    description: 'Upload the files the reports reference',
    commands: IMPORTS,
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
    name: 'status-mapping',
    type: 'list',
    value: '<from=to>',
    core: 'statusMapping',
    env: 'PROBARA_STATUS_MAPPING',
    description: 'Send the results of one status with another, such as failed=blocked',
    commands: IMPORTS,
  },
  {
    name: 'status-filter',
    type: 'list',
    value: '<status>',
    core: 'statusFilter',
    env: 'PROBARA_STATUS_FILTER',
    description: 'Send no result with this status, after --status-mapping',
    commands: IMPORTS,
  },
  {
    name: 'assign-failed-to',
    type: 'list',
    value: '<email>',
    core: 'assignFailedTo',
    env: 'PROBARA_ASSIGN_FAILED_TO',
    description: 'Assign failed results without an assignee to this member, in turn',
    commands: IMPORTS,
  },
  {
    name: 'root-dir',
    type: 'string',
    value: '<dir>',
    core: 'rootDir',
    default: 'the current directory',
    description: 'Directory the file paths of automation keys are relative to',
    commandDetails: { 'import results': "the results file's own comes first" },
    commands: IMPORTS,
  },
  {
    name: 'fail-on-failed-tests',
    type: 'boolean',
    description: 'Exit 3 when a test failed or was blocked',
    commands: FAILS_ON_TESTS,
  },
  {
    name: 'dry-run',
    type: 'boolean',
    description: 'Print what would be sent, and send nothing (no token needed)',
    commands: IMPORTS,
  },
  {
    name: 'results-file',
    type: 'string',
    value: '<path>',
    core: 'resultsFile',
    env: 'PROBARA_RESULTS_FILE',
    description: 'JSON file the results that were not sent are written to',
    commands: ['import junit'],
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
    commands: IMPORTS,
  },
  {
    name: 'attachment-concurrency',
    type: 'integer',
    value: '<n>',
    core: 'attachmentConcurrency',
    default: '2',
    description: 'Results whose attachments upload at the same time, 1 to 8',
    commands: IMPORTS,
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

/** The description of `option` in the help of `command`, with its detail there. */
export function describeOption(option: OptionSpec, command: CommandName): string {
  const detail = option.commandDetails?.[command];
  return detail === undefined ? option.description : `${option.description}; ${detail}`;
}

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

function listOf(value: OptionValue): string[] {
  return Array.isArray(value) ? value : [String(value)];
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
 * `--status-mapping` pairs (`failed=blocked`) as core's status mapping, in any case. Unknown
 * statuses are left to core, which reports them like the variable's.
 *
 * @throws UsageError on a value that is not a pair, or a status mapped twice.
 */
function statusMappingOf(pairs: readonly string[], command: CommandName): Record<string, string> {
  // Without a prototype, `__proto__=failed` is an unknown status like any other, not a setter.
  const mapping = Object.create(null) as Record<string, string>;
  for (const pair of pairs) {
    const parts = pair.split('=').map((part) => part.trim().toLowerCase());
    const [from, to] = parts;
    if (parts.length !== 2 || from === undefined || to === undefined || from === '' || to === '') {
      throw new UsageError(
        '--status-mapping takes <status>=<status> pairs, such as failed=blocked',
        `probara ${command}`,
      );
    }
    if (Object.hasOwn(mapping, from)) {
      throw new UsageError('--status-mapping maps a status twice', `probara ${command}`);
    }
    mapping[from] = to;
  }
  return mapping;
}

/**
 * `--run-ulids` pairs (`WEB=01J…`) as core's `run.ulids`. Project codes and ULIDs are left to core,
 * which reports them like the variable's.
 *
 * @throws UsageError on a value that is not a pair, or a project named twice.
 */
function runUlidsOf(pairs: readonly string[], command: CommandName): Record<string, string> {
  // Without a prototype, `__proto__=…` is a project code like any other, not a setter.
  const runs = Object.create(null) as Record<string, string>;
  for (const pair of pairs) {
    const parts = pair.split('=').map((part) => part.trim());
    const [code, ulid] = parts;
    if (
      parts.length !== 2 ||
      code === undefined ||
      ulid === undefined ||
      code === '' ||
      ulid === ''
    ) {
      throw new UsageError(
        '--run-ulids takes <project>=<run ULID> pairs, such as WEB=01J9Z3K4M5N6P7Q8R9S0T1V2W3',
        `probara ${command}`,
      );
    }
    if (Object.hasOwn(runs, code)) {
      throw new UsageError('--run-ulids names the run of a project twice', `probara ${command}`);
    }
    runs[code] = ulid;
  }
  return runs;
}

/**
 * `--configuration-value` pairs (`Browser=Chrome`, split at the first `=`) as core's
 * `run.configurations`. Names are left to core, which checks them like the variable's.
 *
 * @throws UsageError on a value that is not a pair.
 */
function configurationsOf(
  pairs: readonly string[],
  command: CommandName,
): { group: string; name: string }[] {
  return pairs.map((pair) => {
    const separator = pair.indexOf('=');
    const group = separator === -1 ? '' : pair.slice(0, separator).trim();
    const name = separator === -1 ? '' : pair.slice(separator + 1).trim();
    if (group === '' || name === '') {
      throw new UsageError(
        '--configuration-value takes <group>=<name> pairs, such as Browser=Chrome',
        `probara ${command}`,
      );
    }
    return { group, name };
  });
}

/**
 * The core options of the flags given: only those given, so an unset flag never hides its
 * variable. `rootDir` and `resultsFile` are resolved against `cwd`.
 *
 * @throws UsageError on a malformed `--status-mapping`, `--run-ulids` or `--configuration-value`.
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
    if (spec.core === 'run.ulids') run.ulids = runUlidsOf(listOf(value), command);
    else if (spec.core === 'run.configurations') {
      run.configurations = configurationsOf(listOf(value), command);
    } else if (group === 'run' && field !== undefined) run[field] = value;
    else if (group === 'source' && field !== undefined) source[field] = value;
    else if (spec.core === 'rootDir' || spec.core === 'resultsFile') {
      options[spec.core] = resolve(cwd, String(value));
    } else if (spec.core === 'statusMapping')
      options.statusMapping = statusMappingOf(listOf(value), command);
    else if (spec.core === 'statusFilter') {
      options.statusFilter = listOf(value).map((status) => status.toLowerCase());
    } else options[spec.core] = value;
  }
  if (Object.keys(run).length > 0) options.run = run;
  // `--no-source` wins over the source flags.
  if (options.source !== false && Object.keys(source).length > 0) options.source = source;
  return options;
}
