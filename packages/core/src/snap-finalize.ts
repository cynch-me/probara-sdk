/**
 * Completes a Probara Snap build whose machines joined it by their nonce, without a shard total:
 * the last step of a run split across machines, after every machine sent its screenshots.
 */
import type { SnapBuild } from './api.js';
import { createIdempotencyKey, ProbaraApiError } from './client.js';
import { resolveConfig, type ProbaraOptions } from './config.js';
import { createConsoleLogger, redact, type Logger } from './logger.js';
import {
  clientOf,
  isOptionsObject,
  loggerOf,
  messageOf,
  OPTIONS_NOT_AN_OBJECT,
  safeLogger,
  secretsOf,
  type RuntimeOptions,
} from './runtime.js';
import { snapNonceOf } from './snap-settings.js';

/**
 * Options of {@link finalizeSnapBuildByNonce}. The connection falls back to the `PROBARA_*`
 * variables like a reporter's (`PROBARA_API_TOKEN`, `PROBARA_PROJECT`, `PROBARA_BASE_URL`).
 */
export interface FinalizeSnapOptions
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
  /** The build name the machines sent. Probara's `default` when unset. */
  buildName?: string | undefined;
  /** The nonce the machines sent. What the CI gives when unset (see `snapNonceOf`). */
  nonce?: string | undefined;
}

/** What {@link finalizeSnapBuildByNonce} did. */
export interface SnapFinalizeSummary {
  /**
   * - `finalized`: the build is complete and Probara compares it; `build.url` is its page.
   *   A build that was already finalized answers the same.
   * - `disabled`: reporting is off or not configured; nothing was sent.
   * - `failed`: no nonce is known, or Probara refused or could not be reached (`error`).
   */
  status: 'finalized' | 'disabled' | 'failed';
  build?: { ulid: string; number: number; url: string; jobStatus: SnapBuild['jobStatus'] };
  /** Why it failed, with Probara's code and status when it answered. Never holds the token. */
  error?: { message: string; code?: string; status?: number };
}

const FAILURE = 'Could not finalize the Snap build';
const NONCE_MISSING =
  'no nonce names the build, and this CI gives none: set PROBARA_SNAP_NONCE to the value its machines sent';

function failed(logger: Logger, message: string): SnapFinalizeSummary {
  logger.error(`${FAILURE}: ${message}`);
  return { status: 'failed', error: { message } };
}

/**
 * Finalizes the Snap build of a name and a nonce
 * (`POST /api/v1/projects/{projectId}/snap/builds:finalize`), retried like any request. Probara
 * refuses a build no machine sent (404), one without a finalized shard yet or that failed (409),
 * and one its shard total completes (422). The build's page is logged.
 *
 * Never rejects; failures are logged and returned in the summary.
 */
export async function finalizeSnapBuildByNonce(
  options: FinalizeSnapOptions = {},
): Promise<SnapFinalizeSummary> {
  if (!isOptionsObject(options)) {
    const logger = safeLogger(createConsoleLogger({ debug: false }), secretsOf({}, process.env));
    return failed(logger, OPTIONS_NOT_AN_OBJECT);
  }
  const secrets = secretsOf(options, options.env ?? process.env);
  try {
    return await finalize(options);
  } catch (error) {
    const message = redact(messageOf(error), secrets);
    const logger = safeLogger(options.logger ?? createConsoleLogger({ debug: false }), secrets);
    logger.error(`${FAILURE}: ${message}`);
    return {
      status: 'failed',
      error: {
        message,
        ...(error instanceof ProbaraApiError ? { code: error.code, status: error.status } : {}),
      },
    };
  }
}

async function finalize(options: FinalizeSnapOptions): Promise<SnapFinalizeSummary> {
  const env = options.env ?? process.env;
  const resolution = resolveConfig(
    {
      enabled: options.enabled,
      apiToken: options.apiToken,
      projectId: options.projectId,
      baseUrl: options.baseUrl,
      // A build is no run: the runs and projects of a reporter do not apply.
      run: { ulids: {} },
      projects: [],
      source: false,
      debug: options.debug,
      clientName: options.clientName,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
    },
    env,
  );
  const logger = loggerOf(resolution, options, env);
  if (!resolution.ok && resolution.disabled) {
    logger.debug(resolution.reason);
    return { status: 'disabled' };
  }
  if (!resolution.ok) return failed(logger, resolution.problems.join('; '));
  const { config } = resolution;
  const ciNonce = snapNonceOf(options.nonce, env);
  if (ciNonce === undefined) return failed(logger, NONCE_MISSING);

  const name = options.buildName;
  const build = await clientOf(config, options, logger).finalizeSnapBuildByNonce(
    config.projectId,
    { ...(name === undefined ? {} : { name }), ciNonce },
    { idempotencyKey: createIdempotencyKey() },
  );
  const count = build.screenshotCount;
  logger.info(
    `Finalized the Snap build #${build.number} (${count} ${count === 1 ? 'screenshot' : 'screenshots'}): ${build.url}`,
  );
  return {
    status: 'finalized',
    build: { ulid: build.ulid, number: build.number, url: build.url, jobStatus: build.jobStatus },
  };
}
