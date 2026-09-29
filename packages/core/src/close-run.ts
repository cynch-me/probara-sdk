/** Closes a run on its own: the final step of a CI job whose shards share one run. */
import { createIdempotencyKey, ProbaraApiError } from './client.js';
import { resolveConfig, type ProbaraOptions, type ProbaraRunOptions } from './config.js';
import { createConsoleLogger, redact, type Logger } from './logger.js';
import {
  clientOf,
  loggerOf,
  messageOf,
  runUrlOf,
  safeLogger,
  secretsOf,
  type RuntimeOptions,
} from './runtime.js';

/**
 * Options of {@link closeRun}. Each one falls back to its `PROBARA_*` variable, like the options of
 * a reporter: `PROBARA_API_TOKEN`, `PROBARA_PROJECT` (for the run's page), `PROBARA_BASE_URL` and
 * `PROBARA_RUN_ULID`.
 */
export interface CloseRunOptions
  extends
    Pick<
      ProbaraOptions,
      | 'enabled'
      | 'apiToken'
      | 'projectId'
      | 'baseUrl'
      | 'debug'
      | 'clientName'
      | 'timeoutMs'
      | 'maxRetries'
    >,
    RuntimeOptions {
  /** `PROBARA_RUN_ULID`: the run to close (required). */
  run?: Pick<ProbaraRunOptions, 'ulid'> | undefined;
}

/** What {@link closeRun} did. */
export interface CloseRunSummary {
  /**
   * - `closed`: the run is closed now.
   * - `already_closed`: the run was already closed or aborted (409 `conflict`); nothing changed.
   * - `disabled`: reporting is off or not configured; nothing was sent.
   * - `failed`: a configuration problem, or the close failed (the run may still be open).
   */
  status: 'closed' | 'already_closed' | 'disabled' | 'failed';
  /** The closed run. `url` is its page in Probara. */
  run?: { ulid: string; displayId: string; state: 'open' | 'closed'; url: string };
  /** Why it failed. The message never holds the token. */
  error?: { message: string; code?: string; status?: number };
}

const MISSING_RUN = 'The run is not set: pass run.ulid or set PROBARA_RUN_ULID';

/**
 * Closes one run (`POST /api/v1/runs/{runUlid}/close`), retrying transient failures under one
 * idempotency key. Use it once, after every shard reported into a shared `PROBARA_RUN_ULID`.
 *
 * Idempotent from the caller's point of view: a run that is already closed resolves
 * `already_closed`. Never rejects; failures are logged and returned in the summary.
 */
export async function closeRun(options: CloseRunOptions = {}): Promise<CloseRunSummary> {
  try {
    return await close(options);
  } catch (error) {
    // A malformed option (an adapter bug) must not break the job either.
    const secrets = secretsOf(options, options.env ?? process.env);
    const message = redact(messageOf(error), secrets);
    safeLogger(options.logger ?? createConsoleLogger({ debug: false }), secrets).error(
      `Could not close the Probara run: ${message}`,
    );
    return { status: 'failed', error: { message } };
  }
}

function failed(logger: Logger, message: string): CloseRunSummary {
  logger.error(`Could not close the Probara run: ${message}`);
  return { status: 'failed', error: { message } };
}

async function close(options: CloseRunOptions): Promise<CloseRunSummary> {
  const env = options.env ?? process.env;
  const resolution = resolveConfig(
    {
      enabled: options.enabled,
      apiToken: options.apiToken,
      projectId: options.projectId,
      baseUrl: options.baseUrl,
      debug: options.debug,
      clientName: options.clientName,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      run: { ulid: options.run?.ulid },
    },
    env,
  );
  const logger = loggerOf(resolution, options, env);
  // Warnings are about fields a close does not send (run name, CI source...).
  for (const warning of resolution.warnings) logger.debug(warning);

  if (!resolution.ok && resolution.disabled) {
    logger.debug(resolution.reason);
    return { status: 'disabled' };
  }
  if (!resolution.ok) {
    return failed(logger, resolution.problems.join('; '));
  }

  const { config } = resolution;
  if (!('ulid' in config.run)) return failed(logger, MISSING_RUN);
  const { ulid } = config.run;
  const clean = (text: string) => redact(text, [config.apiToken]);

  try {
    const client = clientOf(config, options, logger);
    const closed = await client.closeRun(ulid, { idempotencyKey: createIdempotencyKey() });
    const url = runUrlOf(config, closed.displayId);
    logger.info(`Closed the run ${closed.displayId}: ${url}`);
    return {
      status: 'closed',
      run: { ulid: closed.ulid, displayId: closed.displayId, state: closed.state, url },
    };
  } catch (error) {
    if (error instanceof ProbaraApiError && error.status === 409 && error.code === 'conflict') {
      logger.info(`The run ${ulid} was already closed or aborted: nothing to close`);
      return { status: 'already_closed' };
    }
    const message = clean(messageOf(error));
    logger.error(`Could not close the run ${ulid}: ${message}`);
    return {
      status: 'failed',
      error: {
        message,
        ...(error instanceof ProbaraApiError ? { code: error.code, status: error.status } : {}),
      },
    };
  }
}
