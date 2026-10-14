/** Closes a run on its own: the final step of a CI job whose shards share one run. */
import type { CloseRunResponse, ReportRequest } from './api.js';
import { createIdempotencyKey, ProbaraApiError, type ProbaraClient } from './client.js';
import {
  resolveConfig,
  type ProbaraOptions,
  type ProbaraRunOptions,
  type ResolvedConfig,
} from './config.js';
import { createConsoleLogger, redact, type Logger } from './logger.js';
import { groupsCiRun } from './source.js';
import {
  clientOf,
  isOptionsObject,
  loggerOf,
  messageOf,
  OPTIONS_NOT_AN_OBJECT,
  runUrlOf,
  safeLogger,
  secretsOf,
  type RuntimeOptions,
} from './runtime.js';

/**
 * Options of {@link closeRun}. Each one falls back to its `PROBARA_*` variable, like the options of
 * a reporter: `PROBARA_API_TOKEN`, `PROBARA_PROJECT`, `PROBARA_BASE_URL`, `PROBARA_RUN_ULID` (else
 * `PROBARA_RUN_ID`) and, for the run of a GitHub Actions workflow run, `PROBARA_RUN_NAME`.
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
      | 'source'
    >,
    RuntimeOptions {
  /**
   * `PROBARA_RUN_ULID` (else `run.id`, `PROBARA_RUN_ID`): the run to close. Without one, in a
   * GitHub Actions workflow run, the run its jobs reported into (named `name`, like theirs).
   */
  run?: Pick<ProbaraRunOptions, 'ulid' | 'id' | 'name'> | undefined;
}

/** What {@link closeRun} did. */
export interface CloseRunSummary {
  /**
   * - `closed`: the run is closed now.
   * - `already_closed`: the run was already closed or aborted (409 `conflict`, or `ci_run_closed`
   *   for the run of a GitHub Actions workflow run); nothing changed.
   * - `disabled`: reporting is off or not configured; nothing was sent.
   * - `failed`: a configuration problem, or the close failed (the run may still be open).
   */
  status: 'closed' | 'already_closed' | 'disabled' | 'failed';
  /** The closed run. `url` is its page in Probara. */
  run?: { ulid: string; displayId: string; state: 'open' | 'closed'; url: string };
  /** Why it failed. The message never holds the token. */
  error?: { message: string; code?: string; status?: number };
}

const MISSING_RUN =
  'The run is not set: pass run.ulid or set PROBARA_RUN_ULID (in GitHub Actions, the workflow run names its run)';

/**
 * Closes one run (`POST /api/v1/runs/{runUlid}/close`), retrying transient failures under one
 * idempotency key. Use it once, after every shard reported into a shared `PROBARA_RUN_ULID`.
 *
 * Without a run, in a GitHub Actions workflow run (its CI source names a repository and a run id),
 * it closes the run the jobs of that workflow run reported into: a report with no results and
 * `options.close` (`run.name` and the CI run of the source). Use it in the final job, once every
 * other job reported.
 *
 * Idempotent from the caller's point of view: a run that is already closed resolves
 * `already_closed`. Never rejects; failures are logged and returned in the summary.
 */
export async function closeRun(options: CloseRunOptions = {}): Promise<CloseRunSummary> {
  if (!isOptionsObject(options)) {
    const logger = safeLogger(createConsoleLogger({ debug: false }), secretsOf({}, process.env));
    return failed(logger, OPTIONS_NOT_AN_OBJECT);
  }
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
      // One run of one project: the runs and projects of a multi-project reporter do not apply.
      run: { ulid: options.run?.ulid, id: options.run?.id, name: options.run?.name, ulids: {} },
      source: options.source,
      projects: [],
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
  const grouped = !('ulid' in config.run) && groupsCiRun(config.source);
  if (!('ulid' in config.run) && !grouped) return failed(logger, MISSING_RUN);
  const ulid = 'ulid' in config.run ? config.run.ulid : undefined;
  const which = ulid ?? 'of this GitHub Actions run';
  const clean = (text: string) => redact(text, [config.apiToken]);

  try {
    const client = clientOf(config, options, logger);
    const closed =
      ulid === undefined
        ? await closeCiRun(client, config)
        : await client.closeRun(ulid, { idempotencyKey: createIdempotencyKey() });
    const url = runUrlOf(config, closed.displayId);
    logger.info(`Closed the run ${closed.displayId}: ${url}`);
    return {
      status: 'closed',
      run: { ulid: closed.ulid, displayId: closed.displayId, state: closed.state, url },
    };
  } catch (error) {
    // An in-flight duplicate of the key also answers 409 `conflict`, with `Retry-After`: the
    // client retries it, and when the retries run out (`retryable`) the close failed.
    if (
      error instanceof ProbaraApiError &&
      error.status === 409 &&
      (error.code === 'conflict' || error.code === 'ci_run_closed') &&
      !error.retryable
    ) {
      logger.info(
        `The run ${which} was already closed${grouped ? '' : ' or aborted'}: nothing to close`,
      );
      return { status: 'already_closed' };
    }
    const message = clean(messageOf(error));
    logger.error(`Could not close the run ${which}: ${message}`);
    return {
      status: 'failed',
      error: {
        message,
        ...(error instanceof ProbaraApiError ? { code: error.code, status: error.status } : {}),
      },
    };
  }
}

/**
 * Closes the run of the GitHub Actions workflow run of `config.source`: a report of no results with
 * `options.close`, into the run the jobs of the same repository, run id and attempt reported into.
 */
async function closeCiRun(
  client: ProbaraClient,
  config: ResolvedConfig,
): Promise<Pick<CloseRunResponse, 'ulid' | 'displayId' | 'state'>> {
  const { provider, repository, ciRunId, ciRunAttempt } = config.source;
  const name = 'name' in config.run ? config.run.name : '';
  // `groupsCiRun` checked the provider, the repository and the run id.
  const body: ReportRequest = {
    run: {
      name,
      source: {
        provider: provider ?? 'github_actions',
        repository: repository ?? '',
        ciRunId: ciRunId ?? '',
        ...(ciRunAttempt === undefined ? {} : { ciRunAttempt }),
      },
    },
    results: [],
    options: { close: true },
  };
  const response = await client.submitReport(config.projectId, body, {
    idempotencyKey: createIdempotencyKey(),
  });
  const { ulid, displayId, state } = response.run;
  if (state !== 'closed') {
    throw new ProbaraApiError(`Probara answered the run ${displayId} still open`, {
      status: 201,
      code: 'invalid_response',
      retryable: false,
    });
  }
  return { ulid, displayId, state };
}
