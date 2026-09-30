/** Creates a run on its own: the first step of a CI job whose shards share one run. */
import { createIdempotencyKey, ProbaraApiError, ProbaraNetworkError } from './client.js';
import {
  resolveConfig,
  type ProbaraOptions,
  type ProbaraRunOptions,
  type ResolvedConfig,
} from './config.js';
import { createConsoleLogger, redact, type Logger } from './logger.js';
import {
  clientOf,
  isOptionsObject,
  loggerOf,
  messageOf,
  newRunFieldsOf,
  OPTIONS_NOT_AN_OBJECT,
  runUrlOf,
  safeLogger,
  secretsOf,
  sourceFieldOf,
  type RuntimeOptions,
} from './runtime.js';

/**
 * Options of {@link createRun}. Each one falls back to its `PROBARA_*` variable, like the options
 * of a reporter: `PROBARA_API_TOKEN`, `PROBARA_PROJECT`, `PROBARA_BASE_URL`, `PROBARA_RUN_NAME`,
 * `PROBARA_RUN_DESCRIPTION`, `PROBARA_RUN_TAGS`, `PROBARA_ENVIRONMENT(_ID)`,
 * `PROBARA_MILESTONE(_ID)`, `PROBARA_PLAN`, `PROBARA_CONFIGURATIONS`,
 * `PROBARA_CONFIGURATION_ULIDS`, and the CI source (`PROBARA_BRANCH`, `PROBARA_COMMIT`,
 * `PROBARA_BUILD_URL`, else the detected CI).
 */
export interface CreateRunOptions
  extends
    Pick<
      ProbaraOptions,
      | 'enabled'
      | 'apiToken'
      | 'projectId'
      | 'baseUrl'
      | 'source'
      | 'debug'
      | 'clientName'
      | 'timeoutMs'
      | 'maxRetries'
    >,
    RuntimeOptions {
  /**
   * The run to create. Setting `ulid` (or `PROBARA_RUN_ULID`) is a mistake here: a run is already
   * configured, so the creation fails without a request.
   */
  run?: ProbaraRunOptions | undefined;
}

/** What {@link createRun} did. */
export interface CreateRunSummary {
  /**
   * - `created`: the run exists now; share `run.ulid` as `PROBARA_RUN_ULID`.
   * - `disabled`: reporting is off or not configured; nothing was sent.
   * - `failed`: a configuration problem, or the creation failed (`error` says whether a run may
   *   have been created anyway).
   */
  status: 'created' | 'disabled' | 'failed';
  /** The created run. `url` is its page in Probara. */
  run?: { ulid: string; displayId: string; state: 'open' | 'closed'; url: string };
  /** Why it failed. The message never holds the token. */
  error?: { message: string; code?: string; status?: number };
}

const RUN_ALREADY_SET =
  'A run is already set (run.ulid or PROBARA_RUN_ULID): unset it to create a new run';

/**
 * Creates one automated run (`POST /api/v1/projects/{projectId}/runs` with `automated: true`, so it
 * starts without cases) from the same settings a reporter would create it from, retrying transient
 * failures under one idempotency key. Share the ULID of
 * the created run with every shard as `PROBARA_RUN_ULID`, then close it with `closeRun`.
 *
 * Never rejects; failures are logged and returned in the summary.
 */
export async function createRun(options: CreateRunOptions = {}): Promise<CreateRunSummary> {
  if (!isOptionsObject(options)) {
    const logger = safeLogger(createConsoleLogger({ debug: false }), secretsOf({}, process.env));
    return failed(logger, OPTIONS_NOT_AN_OBJECT);
  }
  try {
    return await create(options);
  } catch (error) {
    // A malformed option (an adapter bug) must not break the job either.
    const secrets = secretsOf(options, options.env ?? process.env);
    const message = redact(messageOf(error), secrets);
    safeLogger(options.logger ?? createConsoleLogger({ debug: false }), secrets).error(
      `Could not create the Probara run: ${message}`,
    );
    return { status: 'failed', error: { message } };
  }
}

function failed(logger: Logger, message: string): CreateRunSummary {
  logger.error(`Could not create the Probara run: ${message}`);
  return { status: 'failed', error: { message } };
}

/**
 * Whether the request may have reached the server and created the run: no response (a network
 * error or timeout), a 5xx (not stored for a replay), a success body that could not be read, or
 * retries that ran out on an in-flight duplicate (a retryable 409: an earlier attempt under the same
 * key is still running and may create the run).
 */
function mayHaveCreated(error: unknown): boolean {
  if (error instanceof ProbaraNetworkError) return true;
  if (!(error instanceof ProbaraApiError)) return false;
  if (error.status === 409) return error.retryable;
  return error.status >= 500 || error.code === 'invalid_response';
}

function mayHaveCreatedNote(config: ResolvedConfig): string {
  const runs = `${config.baseUrl}/projects/${encodeURIComponent(config.projectId)}/runs`;
  return `A run may have been created anyway: check the runs of ${config.projectId} (${runs}) before creating another.`;
}

async function create(options: CreateRunOptions): Promise<CreateRunSummary> {
  const env = options.env ?? process.env;
  const { now } = options;
  const resolution = resolveConfig(
    {
      enabled: options.enabled,
      apiToken: options.apiToken,
      projectId: options.projectId,
      baseUrl: options.baseUrl,
      // One run of one project: the runs and projects of a multi-project reporter do not apply.
      run: { ...options.run, ulids: {} },
      projects: [],
      source: options.source,
      debug: options.debug,
      clientName: options.clientName,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
    },
    env,
    now === undefined ? {} : { now },
  );
  const logger = loggerOf(resolution, options, env);

  if (!resolution.ok && resolution.disabled) {
    logger.debug(resolution.reason);
    for (const warning of resolution.warnings) logger.debug(warning);
    return { status: 'disabled' };
  }
  if (!resolution.ok) {
    for (const warning of resolution.warnings) logger.warn(warning);
    return failed(logger, resolution.problems.join('; '));
  }

  const { config } = resolution;
  if ('ulid' in config.run) return failed(logger, RUN_ALREADY_SET);
  for (const warning of resolution.warnings) logger.warn(warning);
  const clean = (text: string) => redact(text, [config.apiToken]);

  try {
    const client = clientOf(config, options, logger);
    // Automated: the run starts without cases; the shards report them into it later.
    const body = {
      ...newRunFieldsOf(config.run),
      ...sourceFieldOf(config.source),
      automated: true,
    };
    const created = await client.createRun(config.projectId, body, {
      idempotencyKey: createIdempotencyKey(),
    });
    const url = runUrlOf(config, created.displayId);
    logger.info(`Created the run ${created.displayId}: ${url}`);
    return {
      status: 'created',
      run: { ulid: created.ulid, displayId: created.displayId, state: created.state, url },
    };
  } catch (error) {
    const reason = clean(messageOf(error));
    const message = mayHaveCreated(error) ? `${reason}. ${mayHaveCreatedNote(config)}` : reason;
    logger.error(`Could not create the run: ${message}`);
    return {
      status: 'failed',
      error: {
        message,
        ...(error instanceof ProbaraApiError ? { code: error.code, status: error.status } : {}),
      },
    };
  }
}
