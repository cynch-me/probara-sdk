/** The `--help` of every command, generated from the options registry. */
import { EXIT_CODES, EXIT_TESTS_FAILED } from './exit-codes.js';
import { optionsOf, type CommandName, type OptionSpec } from './options.js';

interface CommandHelp {
  usage: string;
  summary: string;
  /** Paragraphs after the usage line. */
  details: readonly string[];
  /** Variables the command reads that have no flag. */
  environment: readonly (readonly [string, string])[];
}

const TOKEN_VARIABLE = [
  'PROBARA_API_TOKEN',
  'The API token (required). There is no flag for it: a command line leaks.',
] as const;
const ENABLED_VARIABLE = [
  'PROBARA_ENABLED',
  'false turns reporting off: nothing is sent and the exit code is 0.',
] as const;

export const COMMAND_HELP: Readonly<Record<CommandName, CommandHelp>> = {
  'import junit': {
    usage: 'probara import junit [options] <paths...>',
    summary: 'Import JUnit XML files into one Probara run',
    details: [
      'Each path is a file, a directory (every *.xml beneath it) or a glob, relative to the current directory. Quote globs so the shell leaves them to probara. Every file is parsed before anything is sent: one invalid file sends nothing.',
      'Tests link to cases by a probara_case property or by a <PROJECT>-<n> id in their name; the others match by automation key, and missing cases are created.',
    ],
    environment: [TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'run create': {
    usage: 'probara run create [options]',
    summary: 'Create a run for sharded CI and print its ULID',
    details: [
      'Create the run once, before the shards: pass its ULID to every shard as PROBARA_RUN_ULID, and close it with probara run close once every shard reported. On success stdout holds the ULID alone: PROBARA_RUN_ULID=$(probara run create).',
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

function optionRow(option: OptionSpec): string[] {
  const description =
    option.type === 'list'
      ? `${option.description} (repeatable, or comma-separated)`
      : option.description;
  return [
    optionLabel(option),
    description,
    ...(option.choices === undefined ? [] : [`values: ${option.choices.join(', ')}`]),
    ...(option.env === undefined ? [] : [`env: ${option.env}`]),
    ...(option.default === undefined ? [] : [`default: ${option.default}`]),
  ];
}

/** The exit codes of a command: 3 only where --fail-on-failed-tests exists. */
function exitCodeRows(command: CommandName): [string, string][] {
  const failsOnTests = optionsOf(command).some(({ name }) => name === 'fail-on-failed-tests');
  return EXIT_CODES.filter(
    ({ code, commands }) =>
      (commands === undefined || commands.includes(command)) &&
      (failsOnTests || code !== EXIT_TESTS_FAILED),
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
    '',
    'Options:',
    ...table(optionsOf(command).map(optionRow)),
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
