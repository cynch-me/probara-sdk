/**
 * Reads the cases of a run, for an adapter that runs only the tests linked to them (run selection):
 * each case's display id and automation key.
 */
import type { RunCaseKey } from './api.js';
import { ProbaraApiError } from './client.js';
import { resolveConfig, type ProbaraOptions, type ProbaraRunOptions } from './config.js';
import { MAX_RUN_CASE_KEYS_PAGE } from './limits.js';
import { createConsoleLogger, redact } from './logger.js';
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

/**
 * Options of {@link listRunCaseKeys}. Each one falls back to its `PROBARA_*` variable, like the
 * options of a reporter: `PROBARA_API_TOKEN`, `PROBARA_PROJECT`, `PROBARA_BASE_URL` and
 * `PROBARA_RUN_ULID`.
 */
export interface ListRunCaseKeysOptions
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
  /** `PROBARA_RUN_ULID`: the run to read (required). */
  run?: Pick<ProbaraRunOptions, 'ulid'> | undefined;
}

/** What {@link listRunCaseKeys} read. */
export interface RunCaseKeysSummary {
  /**
   * - `listed`: `cases` holds every case of the run.
   * - `disabled`: reporting is off or not configured; nothing was read.
   * - `failed`: a configuration problem, or a page could not be read; `cases` is empty.
   */
  status: 'listed' | 'disabled' | 'failed';
  /** Every case of the run, in the server's order (by case ULID); empty unless `listed`. */
  cases: RunCaseKey[];
  /** Why it failed. The message never holds the token. */
  error?: { message: string; code?: string; status?: number };
}

const MISSING_RUN = 'The run is not set: pass run.ulid or set PROBARA_RUN_ULID';

/**
 * Reads every case of one run (`GET /api/v1/runs/{runUlid}/case-keys`), 200 per page, following
 * `nextCursor` until the last page; each page is retried like any request. A cursor the server
 * answers twice fails instead of reading forever.
 *
 * Never rejects, and logs nothing above debug: the caller says what a failure means (running every
 * test, for run selection). Messages never hold the token.
 */
export async function listRunCaseKeys(
  options: ListRunCaseKeysOptions = {},
): Promise<RunCaseKeysSummary> {
  if (!isOptionsObject(options)) {
    return { status: 'failed', cases: [], error: { message: OPTIONS_NOT_AN_OBJECT } };
  }
  try {
    return await list(options);
  } catch (error) {
    // A malformed option (an adapter bug) must not break the test run either.
    const secrets = secretsOf(options, options.env ?? process.env);
    const message = redact(messageOf(error), secrets);
    safeLogger(options.logger ?? createConsoleLogger({ debug: false }), secrets).debug(
      `Could not read the cases of the run: ${message}`,
    );
    return { status: 'failed', cases: [], error: { message } };
  }
}

async function list(options: ListRunCaseKeysOptions): Promise<RunCaseKeysSummary> {
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
      // One run: the runs and projects of a multi-project reporter do not apply.
      run: { ulid: options.run?.ulid, ulids: {} },
      projects: [],
    },
    env,
  );
  const logger = loggerOf(resolution, options, env);
  // Warnings are about fields a read does not send (run name, CI source...).
  for (const warning of resolution.warnings) logger.debug(warning);

  if (!resolution.ok && resolution.disabled) {
    logger.debug(resolution.reason);
    return { status: 'disabled', cases: [] };
  }
  if (!resolution.ok) {
    return { status: 'failed', cases: [], error: { message: resolution.problems.join('; ') } };
  }
  const { config } = resolution;
  if (!('ulid' in config.run)) {
    return { status: 'failed', cases: [], error: { message: MISSING_RUN } };
  }
  const { ulid } = config.run;
  const clean = (text: string) => redact(text, [config.apiToken]);

  try {
    const client = clientOf(config, options, logger);
    const cases: RunCaseKey[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const page = await client.listRunCaseKeys(ulid, {
        limit: MAX_RUN_CASE_KEYS_PAGE,
        ...(cursor === undefined ? {} : { cursor }),
      });
      cases.push(
        ...page.items.map(({ caseDisplayId, automationKey }) => ({ caseDisplayId, automationKey })),
      );
      if (page.nextCursor === null) break;
      if (seen.has(page.nextCursor)) {
        throw new ProbaraApiError(`Probara answered the cursor ${page.nextCursor} twice`, {
          status: 200,
          code: 'invalid_response',
          retryable: false,
        });
      }
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    logger.debug(`Read the ${cases.length} cases of the run ${ulid}`);
    return { status: 'listed', cases };
  } catch (error) {
    const message = clean(messageOf(error));
    logger.debug(`Could not read the cases of the run ${ulid}: ${message}`);
    return {
      status: 'failed',
      cases: [],
      error: {
        message,
        ...(error instanceof ProbaraApiError ? { code: error.code, status: error.status } : {}),
      },
    };
  }
}
