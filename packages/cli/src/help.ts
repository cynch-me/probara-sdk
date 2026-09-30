/** The `--help` of every command, generated from the options registry. */
import { EXIT_CODES } from './exit-codes.js';
import { describeOption, optionsOf, type CommandName, type OptionSpec } from './options.js';

interface CommandHelp {
  usage: string;
  summary: string;
  /** Paragraphs after the usage line. */
  details: readonly string[];
  /** Lines of a shell example, printed as they are (never wrapped). */
  example?: readonly string[];
  /** Variables the command reads that have no flag. */
  environment: readonly (readonly [string, string])[];
}

const TOKEN_VARIABLE = [
  'PROBARA_API_TOKEN',
  'The API token (required). There is no flag for it: a command line leaks.',
] as const;
const ENABLED_OFF = 'false turns reporting off: nothing is sent';
/** An import still reads and checks its files, and fails on failed tests, while reporting is off. */
const IMPORT_ENABLED_VARIABLE = [
  'PROBARA_ENABLED',
  `${ENABLED_OFF}. The files are still read, so a missing or invalid file exits 2, and --fail-on-failed-tests still exits 3 when a test failed.`,
] as const;
const ENABLED_VARIABLE = [
  'PROBARA_ENABLED',
  `${ENABLED_OFF}, and the exit code is 0 unless the command line is wrong (exit 2).`,
] as const;

export const COMMAND_HELP: Readonly<Record<CommandName, CommandHelp>> = {
  'import junit': {
    usage: 'probara import junit [options] <paths...>',
    summary: 'Import JUnit XML files into one Probara run',
    details: [
      'Each path is a file, a directory (every *.xml beneath it) or a glob, relative to the current directory. Quote globs so the shell leaves them to probara. Every file is parsed before anything is sent: one invalid file sends nothing.',
      'Tests link to cases by a probara_case property or by a <PROJECT>-<n> id in their name; the others match by automation key, and missing cases are created.',
    ],
    environment: [TOKEN_VARIABLE, IMPORT_ENABLED_VARIABLE],
  },
  'import results': {
    usage: 'probara import results [options] <file>',
    summary: 'Send a results file: the results a reporter or an import could not send',
    details: [
      'A reporter or import with --results-file (PROBARA_RESULTS_FILE) writes the results it could not send to that JSON file, or every result while reporting is off. This sends them, into the runs the file names (or the run it describes), with its project and settings; flags, then PROBARA_* variables, win over the file.',
      'The file is consumed: once every result was sent, it is deleted with its <name>-attachments folder; otherwise it is rewritten with only the results still unsent, so running this again never sends a result twice. --dry-run and PROBARA_ENABLED=false leave it as it is.',
    ],
    environment: [TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'run create': {
    usage: 'probara run create [options]',
    summary: 'Create a run for sharded CI and print its ULID',
    details: [
      'Create the run once, before the shards: pass its ULID to every shard as PROBARA_RUN_ULID, and close it with probara run close once every shard reported. On success stdout holds the ULID alone. Assign it first, then export it: an export with the command inside exits 0 even when the creation failed.',
    ],
    example: [
      'PROBARA_RUN_ULID=$(probara run create --run-name "Nightly")',
      'export PROBARA_RUN_ULID',
    ],
    environment: [TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'run close': {
    usage: 'probara run close [options]',
    summary: 'Close a run once every shard reported into it',
    details: ['A run that is already closed (or aborted) counts as closed: the exit code is 0.'],
    environment: [TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
};

const WIDTH = 100;
const INDENT = '  ';

/** `text` wrapped at {@link WIDTH}, each line starting with `indent`. */
function wrap(text: string, indent: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter((part) => part !== '')) {
    if (line !== '' && indent.length + line.length + 1 + word.length > WIDTH) {
      lines.push(`${indent}${line}`);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  if (line !== '') lines.push(`${indent}${line}`);
  return lines;
}

/** How an option is written in the help: `-h, --help`, `--[no-]close-run`, `--tag <tag>`. */
export function optionLabel(option: OptionSpec): string {
  const long =
    option.negation === 'both'
      ? `--[no-]${option.name}`
      : option.negation === 'only'
        ? `--no-${option.name}`
        : `--${option.name}`;
  const flags = option.short === undefined ? long : `-${option.short}, ${long}`;
  return option.value === undefined ? flags : `${flags} ${option.value}`;
}

/** Rows of `[label, description, ...detail lines]`, the descriptions aligned in one column. */
function table(rows: readonly (readonly string[])[]): string[] {
  const column = Math.max(...rows.map(([label = '']) => label.length)) + 2;
  const pad = ' '.repeat(INDENT.length + column);
  return rows.flatMap(([label = '', description = '', ...details]) => {
    const [first = '', ...rest] = wrap(description, pad);
    return [
      `${INDENT}${label.padEnd(column)}${first.slice(pad.length)}`,
      ...rest,
      ...details.flatMap((detail) => wrap(detail, pad)),
    ];
  });
}

function optionRow(option: OptionSpec, command: CommandName): string[] {
  const described = describeOption(option, command);
  const description =
    option.type === 'list' ? `${described} (repeatable, or comma-separated)` : described;
  return [
    optionLabel(option),
    description,
    ...(option.choices === undefined ? [] : [`values: ${option.choices.join(', ')}`]),
    ...(option.env === undefined ? [] : [`env: ${option.env}`]),
    ...(option.default === undefined ? [] : [`default: ${option.default}`]),
  ];
}

/** The exit codes of a command: those of every command, and those of its own. */
function exitCodeRows(command: CommandName): [string, string][] {
  return EXIT_CODES.filter(
    ({ commands }) => commands === undefined || commands.includes(command),
  ).map(({ code, meaning }) => [String(code), meaning]);
}

/** The help of one command. */
export function commandHelp(command: CommandName): string {
  const help = COMMAND_HELP[command];
  return [
    `Usage: ${help.usage}`,
    '',
    `${help.summary}.`,
    ...help.details.flatMap((paragraph) => ['', ...wrap(paragraph, '')]),
    ...(help.example === undefined
      ? []
      : ['', 'Example:', ...help.example.map((line) => `${INDENT}${line}`)]),
    '',
    'Options:',
    ...table(optionsOf(command).map((option) => optionRow(option, command))),
    '',
    'Environment:',
    ...table(help.environment),
    '',
    'Exit codes:',
    ...table(exitCodeRows(command)),
    '',
  ].join('\n');
}

/** The help of a group of commands, such as `probara import`. */
export function groupHelp(group: string, commands: readonly CommandName[]): string {
  return [
    `Usage: probara ${group} <${group === 'import' ? 'format' : 'command'}> [options]`,
    '',
    'Commands:',
    ...table(
      commands.map((command) => {
        const { usage, summary } = COMMAND_HELP[command];
        return [usage.replace(`probara ${group} `, '').replace(' [options]', ''), summary];
      }),
    ),
    '',
    `Run "probara ${group} <${group === 'import' ? 'format' : 'command'}> --help" for its options.`,
    '',
  ].join('\n');
}

/** The help of `probara` itself. */
export function rootHelp(commands: readonly CommandName[]): string {
  return [
    'Usage: probara <command> [options]',
    '',
    'Report automated test results to Probara from any CI.',
    '',
    'Commands:',
    ...table(
      commands.map((command) => {
        const { usage, summary } = COMMAND_HELP[command];
        return [usage.replace('probara ', '').replace(' [options]', ''), summary];
      }),
    ),
    '',
    'Options:',
    ...table([
      ['-h, --help', 'Show the help (of a command, after its name)'],
      ['--version', 'Print the version'],
    ]),
    '',
    'Run "probara <command> --help" for the options of a command.',
    '',
  ].join('\n');
}
