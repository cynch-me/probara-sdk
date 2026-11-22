/**
 * `probara snap finalize`: completes the Probara Snap build the machines of a Cypress run joined by
 * their nonce. The name and the nonce are resolved by core, as the reporters of those machines
 * resolved them, so the command names the build they sent.
 */
import { finalizeSnapBuildByNonce, resolveSnapSettings, snapNonceOf } from '@probara/core';
import { EXIT_OK, EXIT_REPORTING_FAILED, EXIT_USAGE } from '../exit-codes.js';
import { stringOf, type ParsedCommandLine } from '../options.js';
import type { CommandContext } from './context.js';
import { prepare, runtimeOf, settle } from './run.js';

const NONCE_MISSING =
  'The nonce is not set: pass --nonce or set PROBARA_SNAP_NONCE to the value the machines of the run sent (this CI names none)';

export async function finalizeSnapCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const { options, setup, json } = prepare('snap finalize', parsed, context, clientName);
  const { io, logger, output } = context;
  for (const warning of setup.warnings) logger.debug(warning);
  const settled = settle(setup, context, json, 'no build was finalized');
  if (!settled.ready) return settled.exitCode;
  const settings = resolveSnapSettings(
    {
      snapBuildName: stringOf(parsed.values, 'build-name'),
      snapNonce: stringOf(parsed.values, 'nonce'),
    },
    io.env,
  );
  const nonce = snapNonceOf(settings.nonce, io.env);
  if (nonce === undefined) {
    logger.error(NONCE_MISSING);
    return EXIT_USAGE;
  }

  const summary = await finalizeSnapBuildByNonce({
    ...options,
    ...runtimeOf(context),
    nonce,
    ...(settings.buildName === undefined ? {} : { buildName: settings.buildName }),
  });
  if (json) output.json(summary);
  return summary.status === 'finalized' ? EXIT_OK : EXIT_REPORTING_FAILED;
}
