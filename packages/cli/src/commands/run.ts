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

/**
 * The core options of the flags of `command`, resolved with core. Validates as it goes: throws a
 * `UsageError` on a positional argument (the run commands take none), and turns the debug lines of
 * `logger` on from the resolved `debug` (else from `--debug`).
 */
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

type ReadySetup = Extract<Setup, { kind: 'ready' }>;

/** A setup to run the command with, or the exit code of one that is not ready (already logged). */
type Settled = { ready: true; setup: ReadySetup } | { ready: false; exitCode: number };

/** Logs a setup that is disabled or invalid and gives its exit code; passes a ready one on. */
function settle(setup: Setup, context: CommandContext, json: boolean, what: string): Settled {
  const { logger, output } = context;
  if (setup.kind === 'disabled') {
    logger.info(`${setup.reason}: ${what}`);
    if (json) output.json({ status: 'disabled' });
    return { ready: false, exitCode: EXIT_OK };
  }
  if (setup.kind === 'invalid') {
    for (const problem of setup.problems) logger.error(problem);
    return { ready: false, exitCode: EXIT_USAGE };
  }
  return { ready: true, setup };
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
  if (!settled.ready) return settled.exitCode;
  const { config } = settled.setup;
  if ('ulid' in config.run) {
    logger.error(RUN_ALREADY_SET);
    return EXIT_USAGE;
  }

  const summary = await createRun({ ...options, ...runtimeOf(context) });
  if (json) output.json(summary);
  if (summary.status === 'created') {
    if (summary.run !== undefined) {
      if (!json) output.line(summary.run.ulid);
      return EXIT_OK;
    }
    logger.error(
      `The run was created, but Probara did not return it: there is no ULID to share. Check the runs of ${config.projectId} before creating another.`,
    );
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
  if (!settled.ready) return settled.exitCode;
  if (!('ulid' in settled.setup.config.run)) {
    logger.error(RUN_MISSING);
    return EXIT_USAGE;
  }

  const summary = await closeRun({ ...options, ...runtimeOf(context) });
  if (json) output.json(summary);
  return summary.status === 'closed' || summary.status === 'already_closed'
    ? EXIT_OK
    : EXIT_REPORTING_FAILED;
}
