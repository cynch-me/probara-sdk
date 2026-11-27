/** The `probara` command, in-process: `main(argv, io)` resolves the exit code. */
import { importCucumber } from './commands/import-cucumber.js';
import { importJunit } from './commands/import-junit.js';
import { importResults } from './commands/import-results.js';
import { closeRunCommand, createRunCommand } from './commands/run.js';
import { finalizeSnapCommand, uploadSnapCommand, waitSnapCommand } from './commands/snap.js';
import { injectSourceMapsCommand, uploadSourceMapsCommand } from './commands/sourcemaps.js';
import { syncGherkin } from './commands/sync-gherkin.js';
import { createVisCommand } from './commands/vis-create.js';
import { recordVisCommand } from './commands/vis-record.js';
import {
  createRecordingLinkCommand,
  deleteRecordingLinkCommand,
  getRecordingLinkCommand,
  listRecordingLinksCommand,
  revokeRecordingLinkCommand,
  updateRecordingLinkCommand,
} from './commands/vis-recording-links.js';
import {
  deleteVisCommand,
  getVisCommand,
  listVisesCommand,
  updateVisCommand,
} from './commands/vis.js';
import type { CommandContext, CommandIO } from './commands/context.js';
import { EXIT_OK, EXIT_REPORTING_FAILED, EXIT_USAGE } from './exit-codes.js';
import { commandHelp, groupHelp, rootHelp } from './help.js';
import { createCliLogger, createOutput, secretsOf } from './io.js';
import {
  parseCommandLine,
  UsageError,
  wantsHelp,
  type CommandName,
  type ParsedCommandLine,
} from './options.js';
import { VERSION } from './version.js';

export type { CliIO } from './io.js';
export type { CommandIO, StopSignals } from './commands/context.js';

/** The adapter name core sends first in the User-Agent. */
export const CLIENT_NAME = `probara-cli/${VERSION}`;

const RECORDING_LINKS: readonly CommandName[] = [
  'vis recording-links list',
  'vis recording-links get',
  'vis recording-links create',
  'vis recording-links update',
  'vis recording-links revoke',
  'vis recording-links delete',
];
const COMMANDS: readonly CommandName[] = [
  'import junit',
  'import results',
  'import cucumber',
  'run create',
  'run close',
  'sync gherkin',
  'snap upload',
  'snap finalize',
  'snap wait',
  'vis list',
  'vis get',
  'vis create',
  'vis update',
  'vis delete',
  'vis record',
  'sourcemaps inject',
  'sourcemaps upload',
];
const GROUPS: Readonly<Record<string, readonly CommandName[]>> = {
  import: ['import junit', 'import results', 'import cucumber'],
  run: ['run create', 'run close'],
  sync: ['sync gherkin'],
  snap: ['snap upload', 'snap finalize', 'snap wait'],
  vis: ['vis list', 'vis get', 'vis create', 'vis update', 'vis delete', 'vis record'],
  sourcemaps: ['sourcemaps inject', 'sourcemaps upload'],
};
/** The groups inside a group, such as `vis recording-links`: `[name, summary, commands]`. */
const SUBGROUPS: Readonly<
  Record<string, readonly (readonly [string, string, readonly CommandName[]])[]>
> = {
  vis: [
    [
      'recording-links',
      'Manage recording links: URLs anyone records their screen with, as a Vis',
      RECORDING_LINKS,
    ],
  ],
};

/** The groups inside groups, as the root help lists them: `vis recording-links`. */
const ROOT_SUBGROUPS = Object.entries(SUBGROUPS).flatMap(([group, subgroups]) =>
  subgroups.map(([name, summary]) => [`${group} ${name}`, summary] as const),
);

type CommandHandler = (
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
) => Promise<number>;

/** One handler per command: a command without one is a type error. */
const HANDLERS: Readonly<Record<CommandName, CommandHandler>> = {
  'import junit': importJunit,
  'import results': importResults,
  'import cucumber': importCucumber,
  'run create': createRunCommand,
  'run close': closeRunCommand,
  'sync gherkin': syncGherkin,
  'snap finalize': finalizeSnapCommand,
  'snap wait': waitSnapCommand,
  'snap upload': uploadSnapCommand,
  'vis list': listVisesCommand,
  'vis get': getVisCommand,
  'vis create': createVisCommand,
  'vis update': updateVisCommand,
  'vis delete': deleteVisCommand,
  'vis record': recordVisCommand,
  'vis recording-links list': listRecordingLinksCommand,
  'vis recording-links get': getRecordingLinkCommand,
  'vis recording-links create': createRecordingLinkCommand,
  'vis recording-links update': updateRecordingLinkCommand,
  'vis recording-links revoke': revokeRecordingLinkCommand,
  'vis recording-links delete': deleteRecordingLinkCommand,
  'sourcemaps inject': injectSourceMapsCommand,
  'sourcemaps upload': uploadSourceMapsCommand,
};

async function runCommand(
  command: CommandName,
  args: readonly string[],
  context: CommandContext,
): Promise<number> {
  if (wantsHelp(args)) {
    context.io.stdout.write(commandHelp(command));
    return EXIT_OK;
  }
  return HANDLERS[command](parseCommandLine(command, args), context, CLIENT_NAME);
}

async function dispatch(argv: readonly string[], context: CommandContext): Promise<number> {
  const { stdout, stderr } = context.io;
  const [first, second, ...rest] = argv;
  if (first === undefined) {
    stderr.write(rootHelp(COMMANDS, ROOT_SUBGROUPS));
    return EXIT_USAGE;
  }
  if (first === '-h' || first === '--help') {
    stdout.write(rootHelp(COMMANDS, ROOT_SUBGROUPS));
    return EXIT_OK;
  }
  if (first === '--version') {
    stdout.write(`${VERSION}\n`);
    return EXIT_OK;
  }
  const group = GROUPS[first];
  if (group === undefined) {
    const what = first.startsWith('-') ? `Unknown option '${first}'` : `Unknown command "${first}"`;
    throw new UsageError(what, 'probara');
  }
  return dispatchGroup(first, group, SUBGROUPS[first] ?? [], [second, ...rest], context);
}

/** Runs the command of `group` that `args` names, or the group's help when it names none. */
function dispatchGroup(
  name: string,
  group: readonly CommandName[],
  subgroups: readonly (readonly [string, string, readonly CommandName[]])[],
  args: readonly (string | undefined)[],
  context: CommandContext,
): Promise<number> {
  const { stdout, stderr } = context.io;
  const [word, ...rest] = args;
  const help = () =>
    groupHelp(
      name,
      group,
      subgroups.map(([subgroup, summary]) => [subgroup, summary] as const),
    );
  if (word === undefined) {
    stderr.write(help());
    return Promise.resolve(EXIT_USAGE);
  }
  if (word === '-h' || word === '--help') {
    stdout.write(help());
    return Promise.resolve(EXIT_OK);
  }
  const subgroup = subgroups.find(([subgroupName]) => subgroupName === word);
  if (subgroup !== undefined) {
    return dispatchGroup(`${name} ${word}`, subgroup[2], [], rest, context);
  }
  const command = group.find((candidate) => candidate === `${name} ${word}`);
  if (command === undefined) {
    throw new UsageError(`Unknown command "${name} ${word}"`, `probara ${name}`);
  }
  return runCommand(command, rest as string[], context);
}

/**
 * Runs `probara` with `argv` (the arguments after the executable) and resolves its exit code.
 * Never rejects: every failure is logged on `io.stderr`.
 */
export async function main(argv: readonly string[], io: CommandIO): Promise<number> {
  const secrets = secretsOf(io.env);
  const logger = createCliLogger(io.stderr, secrets);
  const context: CommandContext = { io, logger, output: createOutput(io.stdout, secrets) };
  try {
    return await dispatch(argv, context);
  } catch (error) {
    if (error instanceof UsageError) {
      logger.error(`${error.message}. Run "${error.helpCommand} --help" for usage.`);
      return EXIT_USAGE;
    }
    logger.error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_REPORTING_FAILED;
  }
}
