/** The `probara` command, in-process: `main(argv, io)` resolves the exit code. */
import { importJunit } from './commands/import-junit.js';
import { importResults } from './commands/import-results.js';
import { closeRunCommand, createRunCommand } from './commands/run.js';
import type { CommandContext } from './commands/context.js';
import { EXIT_OK, EXIT_REPORTING_FAILED, EXIT_USAGE } from './exit-codes.js';
import { commandHelp, groupHelp, rootHelp } from './help.js';
import { createCliLogger, createOutput, secretsOf, type CliIO } from './io.js';
import {
  parseCommandLine,
  UsageError,
  wantsHelp,
  type CommandName,
  type ParsedCommandLine,
} from './options.js';
import { VERSION } from './version.js';

export type { CliIO } from './io.js';

/** The adapter name core sends first in the User-Agent. */
export const CLIENT_NAME = `probara-cli/${VERSION}`;

const COMMANDS: readonly CommandName[] = [
  'import junit',
  'import results',
  'run create',
  'run close',
];
const GROUPS: Readonly<Record<string, readonly CommandName[]>> = {
  import: ['import junit', 'import results'],
  run: ['run create', 'run close'],
};

type CommandHandler = (
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
) => Promise<number>;

/** One handler per command: a command without one is a type error. */
const HANDLERS: Readonly<Record<CommandName, CommandHandler>> = {
  'import junit': importJunit,
  'import results': importResults,
  'run create': createRunCommand,
  'run close': closeRunCommand,
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
    stderr.write(rootHelp(COMMANDS));
    return EXIT_USAGE;
  }
  if (first === '-h' || first === '--help') {
    stdout.write(rootHelp(COMMANDS));
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
  if (second === undefined) {
    stderr.write(groupHelp(first, group));
    return EXIT_USAGE;
  }
  if (second === '-h' || second === '--help') {
    stdout.write(groupHelp(first, group));
    return EXIT_OK;
  }
  const command = group.find((name) => name === `${first} ${second}`);
  if (command === undefined) {
    throw new UsageError(`Unknown command "${first} ${second}"`, `probara ${first}`);
  }
  return runCommand(command, rest, context);
}

/**
 * Runs `probara` with `argv` (the arguments after the executable) and resolves its exit code.
 * Never rejects: every failure is logged on `io.stderr`.
 */
export async function main(argv: readonly string[], io: CliIO): Promise<number> {
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
