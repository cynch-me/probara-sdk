/**
 * Reads the cases of a run, for an adapter that runs only the tests linked to them (run selection):
 * each case's display id and automation key.
 */
import type { RunCaseKey } from './api.js';
import { ProbaraApiError } from './client.js';
import { resolveConfig, type ProbaraOptions, type ProbaraRunOptions } from './config.js';
import { MAX_RUN_CASE_KEYS_PAGE, MAX_RUN_CASE_KEYS_PAGES } from './limits.js';
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

const TOO_MANY_PAGES = `The run has more than ${MAX_RUN_CASE_KEYS_PAGES * MAX_RUN_CASE_KEYS_PAGE} cases: stopped after ${MAX_RUN_CASE_KEYS_PAGES} pages of GET /api/v1/runs/{runUlid}/case-keys`;

/** `logger` with every level written at debug: what the client warns about is the caller's call. */
function debugOnly(logger: Logger): Logger {
  const debug = (message: string) => {
    logger.debug(message);
  };
  return { debug, info: debug, warn: debug, error: debug };
}

/**
 * Reads every case of one run (`GET /api/v1/runs/{runUlid}/case-keys`), 200 per page, following
 * `nextCursor` until the last page; each page is retried like any request (its retries logged at
 * debug). A cursor that does not sort after the one before (cursors are case ULIDs, in order), or
 * more than {@link MAX_RUN_CASE_KEYS_PAGES} pages, fails instead of reading forever.
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
    const client = clientOf(config, options, debugOnly(logger));
    const cases: RunCaseKey[] = [];
    let cursor: string | undefined;
    for (let pages = 1; ; pages += 1) {
      const page = await client.listRunCaseKeys(ulid, {
        limit: MAX_RUN_CASE_KEYS_PAGE,
        ...(cursor === undefined ? {} : { cursor }),
      });
      cases.push(
        ...page.items.map(({ caseDisplayId, automationKey }) => ({ caseDisplayId, automationKey })),
      );
      const next = page.nextCursor;
      if (next === null) break;
      if (cursor !== undefined && next <= cursor) {
        throw new ProbaraApiError(
          `Probara answered the cursor ${next} after ${cursor}: each cursor must sort after the one before`,
          { status: 200, code: 'invalid_response', retryable: false },
        );
      }
      if (pages >= MAX_RUN_CASE_KEYS_PAGES) {
        throw new ProbaraApiError(TOO_MANY_PAGES, {
          status: 200,
          code: 'too_many_pages',
          retryable: false,
        });
      }
      cursor = next;
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
