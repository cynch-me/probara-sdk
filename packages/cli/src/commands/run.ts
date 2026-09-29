/** `probara run create` and `probara run close`: one run shared by the shards of a CI job. */
import { closeRun, createRun, type ProbaraOptions } from '@probara/core';
import { resolveSetup, type Setup } from '../configuration.js';
import { EXIT_OK, EXIT_REPORTING_FAILED, EXIT_USAGE } from '../exit-codes.js';
import { toCoreOptions, UsageError, type CommandName, type ParsedCommandLine } from '../options.js';
import type { CommandContext } from './context.js';

const RUN_ALREADY_SET =
  'PROBARA_RUN_ULID is already set: a run exists for this job. Unset it to create a new run';
const RUN_MISSING = 'The run is not set: pass --run-ulid or set PROBARA_RUN_ULID';

interface Prepared {
  options: ProbaraOptions;
  setup: Setup;
  json: boolean;
}

/** The core options of the flags of `command`, resolved with core. */
function prepare(
  command: CommandName,
  { values, positionals }: ParsedCommandLine,
  { io, logger }: CommandContext,
  clientName: string,
): Prepared {
  const [unexpected] = positionals;
  if (unexpected !== undefined) {
    throw new UsageError(`Unexpected argument "${unexpected}"`, `probara ${command}`);
  }
  const options: ProbaraOptions = { ...toCoreOptions(command, values, io.cwd), clientName };
  const setup = resolveSetup(options, io.env, { requireCredentials: true, now: io.now });
  logger.debugEnabled = setup.kind === 'ready' ? setup.config.debug : values.get('debug') === true;
  return { options, setup, json: values.get('json') === true };
}

/** Seams and the CLI logger for a core call. */
function runtimeOf({ io, logger }: CommandContext) {
  return {
    logger,
    env: io.env,
    ...(io.fetch === undefined ? {} : { fetch: io.fetch }),
    ...(io.sleep === undefined ? {} : { sleep: io.sleep }),
    ...(io.now === undefined ? {} : { now: io.now }),
  };
}

/** Logs a setup that is not ready and returns its exit code; `undefined` when it is ready. */
function settle(
  setup: Setup,
  context: CommandContext,
  json: boolean,
  what: string,
): number | undefined {
  const { logger, output } = context;
  if (setup.kind === 'disabled') {
    logger.info(`${setup.reason}: ${what}`);
    if (json) output.json({ status: 'disabled' });
    return EXIT_OK;
  }
  if (setup.kind === 'invalid') {
    for (const problem of setup.problems) logger.error(problem);
    return EXIT_USAGE;
  }
  return undefined;
}

export async function createRunCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const { options, setup, json } = prepare('run create', parsed, context, clientName);
  const { logger, output } = context;
  for (const warning of setup.warnings) logger.warn(warning);
  const settled = settle(setup, context, json, 'no run was created');
  if (settled !== undefined) return settled;
  if (setup.kind === 'ready' && 'ulid' in setup.config.run) {
    logger.error(RUN_ALREADY_SET);
    return EXIT_USAGE;
  }

  const summary = await createRun({ ...options, ...runtimeOf(context) });
  if (json) output.json(summary);
  if (summary.status === 'created' && summary.run !== undefined) {
    if (!json) output.line(summary.run.ulid);
    return EXIT_OK;
  }
  // Configuration mistakes were caught above: what is left failed at runtime.
  return EXIT_REPORTING_FAILED;
}

export async function closeRunCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const { options, setup, json } = prepare('run close', parsed, context, clientName);
  const { logger, output } = context;
  // Like core's close: warnings are about fields a close does not send (a run name...).
  for (const warning of setup.warnings) logger.debug(warning);
  const settled = settle(setup, context, json, 'no run was closed');
  if (settled !== undefined) return settled;
  if (setup.kind === 'ready' && !('ulid' in setup.config.run)) {
    logger.error(RUN_MISSING);
    return EXIT_USAGE;
  }

  const summary = await closeRun({ ...options, ...runtimeOf(context) });
  if (json) output.json(summary);
  return summary.status === 'closed' || summary.status === 'already_closed'
    ? EXIT_OK
    : EXIT_REPORTING_FAILED;
}
