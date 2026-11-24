/**
 * Waits for a Probara Snap build to be compared: the step of a CI that gates on visual changes
 * without the GitHub status Probara posts.
 */
import type { SnapBuild } from './api.js';
import { detectSnapCiSource } from './ci.js';
import { ProbaraApiError, type ProbaraClient } from './client.js';
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

/**
 * Options of {@link waitForSnapBuild}. The connection falls back to the `PROBARA_*` variables like
 * a reporter's (`PROBARA_API_TOKEN`, `PROBARA_PROJECT`, `PROBARA_BASE_URL`). `sleep` and `now`
 * are the clock of the wait too.
 */
export interface WaitSnapOptions
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
  /** The ULID of the build. Wins over the nonce and the commit. */
  buildUlid?: string | undefined;
  /** The build name the jobs sent. Probara's `default` when unset. */
  buildName?: string | undefined;
  /**
   * The nonce the jobs sent. Unset, the nonce the CI gives is tried, then the commit of the CI
   * (`PROBARA_COMMIT` wins), for a build sent without a nonce.
   */
  nonce?: string | undefined;
  /** How long to wait for the build to be compared, in milliseconds. Defaults to 15 minutes. */
  waitTimeoutMs?: number | undefined;
  /** How long to wait between two reads of the build, in milliseconds. Defaults to 5 seconds. */
  intervalMs?: number | undefined;
}

/** What {@link waitForSnapBuild} saw. */
export interface SnapWaitSummary {
  /**
   * - `complete`: every screenshot is compared; `unacceptedChanges` says whether it has changes
   *   its review did not accept (none yet, or rejected); a reference build only when rejected.
   * - `error`, `expired`: the build ended without being compared.
   * - `timeout`: the build was still pending or in progress when the wait ran out.
   * - `disabled`: reporting is off or not configured; nothing was sent.
   * - `failed`: no build matched, or Probara refused or could not be reached (`error`).
   */
  status: 'complete' | 'error' | 'expired' | 'timeout' | 'disabled' | 'failed';
  /** The build as Probara last answered it. */
  build?: SnapBuild;
  unacceptedChanges?: boolean;
  /** Why it failed, with Probara's code and status when it answered. Never holds the token. */
  error?: { message: string; code?: string; status?: number };
}

const FAILURE = 'Could not wait for the Snap build';
const DEFAULT_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5000;
const NOTHING_NAMES_IT =
  'no build names the Snap build: pass its ULID, or a nonce, or set PROBARA_COMMIT to the commit it is of';

class NoBuild extends Error {}

function failed(logger: Logger, message: string): SnapWaitSummary {
  logger.error(`${FAILURE}: ${message}`);
  return { status: 'failed', error: { message } };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `ms` as minutes when whole, else as seconds. */
function durationOf(ms: number): string {
  const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;
  return ms % 60_000 === 0
    ? plural(ms / 60_000, 'minute')
    : plural(Math.round(ms / 1000), 'second');
}

function hasUnacceptedChanges(build: SnapBuild): boolean {
  if (build.reviewStatus === 'rejected') return true;
  if (build.type === 'reference') return false;
  return build.conclusion === 'changes-detected' && build.reviewStatus !== 'accepted';
}

/** How the build compared, as Probara's status on the commit says it. */
function outcomeOf(build: SnapBuild): string {
  if (build.conclusion !== 'changes-detected') return 'no visual changes';
  if (build.reviewStatus === 'accepted') return 'changes accepted';
  if (build.reviewStatus === 'rejected') return 'changes rejected';
  const { changed, added, removed } = build.diffCounts;
  if (build.type === 'reference') {
    return `reference build, ${changed} changed, ${added} added, ${removed} removed`;
  }
  return `${changed} changed, ${added} added, ${removed} removed, waiting for review`;
}

function isOver(build: SnapBuild): boolean {
  return build.jobStatus !== 'pending' && build.jobStatus !== 'progress';
}

/**
 * Waits until a Snap build is compared (`complete`), ends (`error`, `expired`) or the wait runs
 * out. The build is the one of `buildUlid`; else the newest of the build name and the nonce; else
 * the newest of the build name and the commit of the CI. It is read every `intervalMs`
 * (`GET .../snap/builds/{buildUlid}`), each read retried like any request. A build no lookup
 * finds fails at once: the jobs that send it run before the wait.
 *
 * Never rejects; failures are logged and returned in the summary.
 */
export async function waitForSnapBuild(options: WaitSnapOptions = {}): Promise<SnapWaitSummary> {
  if (!isOptionsObject(options)) {
    const logger = safeLogger(createConsoleLogger({ debug: false }), secretsOf({}, process.env));
    return failed(logger, OPTIONS_NOT_AN_OBJECT);
  }
  const secrets = secretsOf(options, options.env ?? process.env);
  try {
    return await wait(options);
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

/** The newest build of the name and the nonce, else of the name and the commit, as `options` name it. */
async function findBuild(
  client: ProbaraClient,
  projectId: string,
  options: WaitSnapOptions,
  env: NonNullable<RuntimeOptions['env']>,
): Promise<SnapBuild> {
  if (options.buildUlid !== undefined) return client.getSnapBuild(projectId, options.buildUlid);
  const name = options.buildName ?? 'default';
  const newest = async (filter: { ciNonce: string } | { commit: string }) =>
    (await client.listSnapBuilds(projectId, { name, ...filter, pageSize: 1 })).items[0];
  if (options.nonce !== undefined) {
    const build = await newest({ ciNonce: options.nonce });
    if (build === undefined) {
      throw new NoBuild(`no Snap build named "${name}" has the nonce "${options.nonce}"`);
    }
    return build;
  }
  const ci = detectSnapCiSource(env);
  if (ci.snapNonce === undefined && ci.headCommit === undefined)
    throw new NoBuild(NOTHING_NAMES_IT);
  const byNonce = ci.snapNonce === undefined ? undefined : await newest({ ciNonce: ci.snapNonce });
  if (byNonce !== undefined) return byNonce;
  const commit = ci.headCommit?.toLowerCase();
  const byCommit = commit === undefined ? undefined : await newest({ commit });
  if (byCommit !== undefined) return byCommit;
  const of = [
    ...(ci.snapNonce === undefined ? [] : [`the nonce "${ci.snapNonce}"`]),
    ...(commit === undefined ? [] : [`the commit ${commit}`]),
  ].join(' or ');
  throw new NoBuild(`no Snap build named "${name}" has ${of}`);
}

async function wait(options: WaitSnapOptions): Promise<SnapWaitSummary> {
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
  const now = () => (options.now ?? (() => new Date()))().getTime();
  const sleep = options.sleep ?? defaultSleep;
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = now() + waitTimeoutMs;
  const client = clientOf(config, options, logger);

  let build: SnapBuild;
  try {
    build = await findBuild(client, config.projectId, options, env);
  } catch (error) {
    if (error instanceof NoBuild) return failed(logger, error.message);
    throw error;
  }
  if (!isOver(build)) logger.info(`Waiting for the Snap build #${build.number}: ${build.url}`);
  while (!isOver(build)) {
    const left = deadline - now();
    if (left <= 0) {
      logger.error(
        `Gave up waiting for the Snap build #${build.number} after ${durationOf(waitTimeoutMs)}: it is still ${build.jobStatus}: ${build.url}`,
      );
      return { status: 'timeout', build };
    }
    await sleep(Math.min(intervalMs, left));
    build = await client.getSnapBuild(config.projectId, build.ulid);
    logger.debug(`The Snap build #${build.number} is ${build.jobStatus}`);
  }
  if (build.jobStatus === 'complete') {
    logger.info(`The Snap build #${build.number} is complete: ${outcomeOf(build)}: ${build.url}`);
    return { status: 'complete', build, unacceptedChanges: hasUnacceptedChanges(build) };
  }
  if (build.jobStatus === 'expired') {
    logger.error(
      `The Snap build #${build.number} expired before every screenshot arrived: ${build.url}`,
    );
    return { status: 'expired', build };
  }
  const code = build.errorCode === null ? '' : ` (${build.errorCode})`;
  logger.error(`The Snap build #${build.number} ended with an error${code}: ${build.url}`);
  return { status: 'error', build };
}
