/**
 * Probara Snap: sends the screenshots of one job as a shard of a build. Node only (it hashes with
 * `node:crypto` and reads files), so it is no part of `@probara/core/browser`.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type {
  CreateSnapBuildRequest,
  SnapBuild,
  SnapScreenshotEntry,
  SnapScreenshotTest,
} from './api.js';
import { detectSnapCiSource } from './ci.js';
import { snapParentCommits } from './snap-git.js';
import { snapNonceOf } from './snap-settings.js';
import { snapPageUrl, type SnapTool } from './snap-transport.js';
import { createIdempotencyKey, ProbaraApiError, type ProbaraClient } from './client.js';
import { resolveConfig, type ProbaraOptions } from './config.js';
import { createConsoleLogger, redact, type Logger } from './logger.js';
import { VERSION } from './version.js';
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

/** One screenshot to send: a PNG in memory (`body`) or on disk (`path`), and what identifies it. */
export interface SnapScreenshotInput {
  /** The name of the screenshot: with its test, browser, viewport and color mode, its identity in a build. */
  name: string;
  /** The PNG bytes. */
  body?: Uint8Array | undefined;
  /** The PNG file, read when `body` is not given. */
  path?: string | undefined;
  /** Such as `chromium`. */
  browser?: string | undefined;
  viewport?: { width: number; height: number } | undefined;
  colorMode?: 'light' | 'dark' | undefined;
  /** How different two pixels must be to count as a change, from 0 to 1. Probara's default when unset. */
  threshold?: number | undefined;
  /** The test that took it. */
  test?: SnapScreenshotTest | undefined;
  browserVersion?: string | undefined;
  /** The page it was taken of; only an http or https URL is sent. */
  url?: string | undefined;
  /** The test framework that drove the browser, such as `@playwright/test`. */
  automationLibrary?: SnapTool | undefined;
  /** The Probara package that uploads it, when not the one of {@link UploadSnapOptions.sdk}. */
  sdk?: SnapTool | undefined;
}

/**
 * Options of {@link uploadSnapScreenshots}. The connection falls back to the `PROBARA_*` variables
 * like a reporter's (`PROBARA_API_TOKEN`, `PROBARA_PROJECT`, `PROBARA_BASE_URL`); the commit,
 * branches, pull request and nonce come from the CI (`PROBARA_COMMIT`, `PROBARA_BRANCH`; see
 * `detectSnapCiSource`).
 */
export interface UploadSnapOptions
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
  screenshots: readonly SnapScreenshotInput[];
  /** The build name, when one run uploads several builds. Probara's `default` when unset. */
  buildName?: string | undefined;
  /**
   * What the shards of one CI run share, so they join one build. For a sharded run it defaults to
   * what the CI gives (the run id and attempt on GitHub Actions, else the provider's pipeline id);
   * a run without shards sends none, and is a build of its own.
   */
  nonce?: string | undefined;
  /**
   * The shard this job is of a run split in `total` jobs (`index` from 0). The shards join one
   * build by the nonce they share, which a sharded run therefore needs. Without it, the job is the
   * whole build.
   */
  shard?: { index: number; total: number } | undefined;
  /**
   * The job is one machine of a run split without a known total (Cypress `--parallel`, an
   * orchestrator that balances specs). It joins the build of the nonce, sent without a shard
   * total and even without screenshots, and the build is complete once
   * `finalizeSnapBuildByNonce` (`probara snap finalize`) says so. The nonce defaults to what the
   * CI gives, as for a sharded run. A `shard` of several jobs wins: its total completes the build.
   */
  parallel?: boolean | undefined;
  /** The Probara run the build belongs to, when the job reported one. */
  runUlid?: string | undefined;
  /** The Probara package that uploads the screenshots: `@probara/core` and its version when unset. */
  sdk?: SnapTool | undefined;
  /** Files uploaded at a time. Defaults to 4. */
  concurrency?: number | undefined;
  /**
   * The git checkout whose history names the commits Probara picks the baseline among (see
   * `parentCommits`). Defaults to the current directory.
   */
  cwd?: string | undefined;
}

/** What {@link uploadSnapScreenshots} did. */
export interface SnapSummary {
  /**
   * - `uploaded`: the shard is finalized; `build.url` is the build's page. A shard of a sharded
   *   run is finalized without screenshots too, so its build does not wait for it.
   * - `empty`: no screenshot to send in a run without shards; nothing was sent.
   * - `disabled`: reporting is off or not configured; nothing was sent.
   * - `failed`: a problem before any request, or a refused or failed request (`error`).
   */
  status: 'uploaded' | 'empty' | 'disabled' | 'failed';
  build?: { ulid: string; number: number; url: string; jobStatus: SnapBuild['jobStatus'] };
  /** Screenshots recorded in the build. */
  screenshots: number;
  /** Files uploaded: the ones Probara did not hold yet. */
  files: number;
  /**
   * Why it failed. `code` is `snap_screenshot_limit_reached` when the shard does not fit in the
   * plan's monthly allowance. The message never holds the token.
   */
  error?: { message: string; code?: string; status?: number };
}

const DEFAULT_CONCURRENCY = 4;
const MAX_SCREENSHOTS_PER_SHARD = 5000;
const FULL_COMMIT = /^[0-9a-f]{40}$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const FAILURE = 'Could not send the Snap screenshots';

const DEFAULT_SDK: SnapTool = { name: '@probara/core', version: VERSION };
const MAX_URL_LENGTH = 2048;
const MAX_BROWSER_VERSION_LENGTH = 64;
const MAX_TOOL_NAME_LENGTH = 128;
const MAX_TOOL_VERSION_LENGTH = 64;
const MAX_ANNOTATIONS = 20;
const MAX_ANNOTATION_TYPE_LENGTH = 128;
const MAX_ANNOTATION_DESCRIPTION_LENGTH = 2048;
const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 128;

/** `value` trimmed and cut to `max` characters, or `undefined` when it is no text or blank. */
function textOf(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, max).trim();
  return trimmed === '' ? undefined : trimmed;
}

function toolOf(tool: unknown): SnapTool | undefined {
  if (typeof tool !== 'object' || tool === null) return undefined;
  const { name, version } = tool as Record<string, unknown>;
  const kept = {
    name: textOf(name, MAX_TOOL_NAME_LENGTH),
    version: textOf(version, MAX_TOOL_VERSION_LENGTH),
  };
  return kept.name === undefined || kept.version === undefined
    ? undefined
    : { name: kept.name, version: kept.version };
}

function urlOf(url: unknown): string | undefined {
  const page = snapPageUrl(url);
  return page !== undefined && page.length <= MAX_URL_LENGTH ? page : undefined;
}

function integerOf(value: unknown, least: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= least ? value : undefined;
}

function annotationsOf(annotations: unknown): SnapScreenshotTest['annotations'] {
  if (!Array.isArray(annotations)) return undefined;
  const kept: NonNullable<SnapScreenshotTest['annotations']> = [];
  for (const annotation of annotations as unknown[]) {
    if (kept.length === MAX_ANNOTATIONS) break;
    if (typeof annotation !== 'object' || annotation === null) continue;
    const { type, description } = annotation as Record<string, unknown>;
    const name = textOf(type, MAX_ANNOTATION_TYPE_LENGTH);
    if (name === undefined) continue;
    kept.push({
      type: name,
      ...(typeof description === 'string'
        ? { description: description.slice(0, MAX_ANNOTATION_DESCRIPTION_LENGTH) }
        : {}),
    });
  }
  return kept.length === 0 ? undefined : kept;
}

function tagsOf(tags: unknown): string[] | undefined {
  if (!Array.isArray(tags)) return undefined;
  const kept = new Set<string>();
  for (const tag of tags as unknown[]) {
    if (kept.size === MAX_TAGS) break;
    const name = textOf(tag, MAX_TAG_LENGTH);
    if (name !== undefined) kept.add(name);
  }
  return kept.size === 0 ? undefined : [...kept];
}

/** The test of a screenshot with only what the Snap API accepts of its location, retries, annotations and tags. */
function testEntryOf(test: SnapScreenshotTest): SnapScreenshotTest {
  const { line, column, retries, annotations, tags, ...rest } = test;
  const kept = {
    line: integerOf(line, 1),
    column: integerOf(column, 1),
    retries: integerOf(retries, 0),
    annotations: annotationsOf(annotations),
    tags: tagsOf(tags),
  };
  return {
    ...rest,
    ...(kept.line === undefined ? {} : { line: kept.line }),
    ...(kept.column === undefined ? {} : { column: kept.column }),
    ...(kept.retries === undefined ? {} : { retries: kept.retries }),
    ...(kept.annotations === undefined ? {} : { annotations: kept.annotations }),
    ...(kept.tags === undefined ? {} : { tags: kept.tags }),
  };
}

/** The SHA-256 of `bytes` in lowercase hex: how the Snap API names a file. */
export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A problem found before any request: its message is the whole explanation. */
class SnapProblem extends Error {}

interface Prepared {
  entry: SnapScreenshotEntry;
  bytes: Uint8Array;
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

async function bytesOf({ name, body, path }: SnapScreenshotInput): Promise<Uint8Array> {
  if (body !== undefined) return body;
  if (path === undefined) throw new SnapProblem(`the screenshot "${name}" has no body and no path`);
  try {
    return await readFile(path);
  } catch (error) {
    throw new SnapProblem(`could not read the screenshot "${name}": ${messageOf(error)}`);
  }
}

async function prepare(input: SnapScreenshotInput, uploader: SnapTool): Promise<Prepared> {
  const { name, browser, viewport, colorMode, threshold, test } = input;
  const bytes = await bytesOf(input);
  if (!isPng(bytes)) throw new SnapProblem(`the screenshot "${name}" is not a PNG`);
  const browserVersion = textOf(input.browserVersion, MAX_BROWSER_VERSION_LENGTH);
  const url = urlOf(input.url);
  const sdk = toolOf(input.sdk) ?? uploader;
  const automationLibrary = toolOf(input.automationLibrary);
  return {
    bytes,
    entry: {
      name,
      sha256: sha256Of(bytes),
      ...(browser === undefined ? {} : { browser }),
      ...(viewport === undefined
        ? {}
        : { viewport: { width: viewport.width, height: viewport.height } }),
      ...(colorMode === undefined ? {} : { colorMode }),
      ...(threshold === undefined ? {} : { threshold }),
      ...(test === undefined ? {} : { test: testEntryOf(test) }),
      ...(browserVersion === undefined ? {} : { browserVersion }),
      ...(url === undefined ? {} : { url }),
      sdk,
      ...(automationLibrary === undefined ? {} : { automationLibrary }),
    },
  };
}

/**
 * What makes a screenshot one of its build: the test that took it (its automation key), its name,
 * browser, viewport and color mode.
 */
function identityOf({ name, browser, viewport, colorMode, test }: SnapScreenshotEntry): string {
  return JSON.stringify([
    test?.automationKey,
    name,
    browser,
    viewport?.width,
    viewport?.height,
    colorMode,
  ]);
}

function checkIdentities(prepared: readonly Prepared[]): void {
  const seen = new Set<string>();
  for (const { entry } of prepared) {
    const identity = identityOf(entry);
    if (seen.has(identity)) {
      throw new SnapProblem(
        `two screenshots of one test are named "${entry.name}" (same browser, viewport and color mode): a test holds one of each`,
      );
    }
    seen.add(identity);
  }
}

/** The digests a refused finalize says Probara does not hold (409 `conflict`, `details.missingFiles`). */
function missingFilesOf(error: unknown): string[] | undefined {
  if (!(error instanceof ProbaraApiError) || error.status !== 409 || error.code !== 'conflict') {
    return undefined;
  }
  const missing = (error.details as { missingFiles?: unknown } | null | undefined)?.missingFiles;
  if (!Array.isArray(missing) || missing.length === 0) return undefined;
  return missing.filter((digest): digest is string => typeof digest === 'string');
}

/** Runs `task` over `items`, at most `concurrency` at a time; the first failure stops the rest. */
async function inParallel<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | undefined;
  const worker = async () => {
    while (failure === undefined && next < items.length) {
      const item = items[next] as T;
      next += 1;
      try {
        await task(item);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failure !== undefined) throw failure.error;
}

function failed(
  logger: Logger,
  message: string,
  counts = { screenshots: 0, files: 0 },
): SnapSummary {
  logger.error(`${FAILURE}: ${message}`);
  return { status: 'failed', ...counts, error: { message } };
}

/**
 * Sends the screenshots of one job to Probara Snap: creates the build of the commit (or joins the
 * one the other shards of the CI run created), uploads the PNGs Probara does not hold yet (each
 * retried like any request, `concurrency` at a time), and finalizes the shard. When the finalize
 * answers that files are missing (one Probara held was swept meanwhile), it uploads those and
 * finalizes once more. It stops at the plan's monthly screenshot limit
 * (`snap_screenshot_limit_reached`) with what Probara says. The build's page is logged.
 *
 * Never rejects; failures are logged and returned in the summary.
 */
export async function uploadSnapScreenshots(options: UploadSnapOptions): Promise<SnapSummary> {
  if (!isOptionsObject(options)) {
    const logger = safeLogger(createConsoleLogger({ debug: false }), secretsOf({}, process.env));
    return failed(logger, OPTIONS_NOT_AN_OBJECT);
  }
  const counts = { screenshots: 0, files: 0 };
  const secrets = secretsOf(options, options.env ?? process.env);
  try {
    return await upload(options, counts);
  } catch (error) {
    const message = redact(messageOf(error), secrets);
    const logger = safeLogger(options.logger ?? createConsoleLogger({ debug: false }), secrets);
    logger.error(`${FAILURE}: ${message}`);
    return {
      status: 'failed',
      ...counts,
      error: {
        message,
        ...(error instanceof ProbaraApiError ? { code: error.code, status: error.status } : {}),
      },
    };
  }
}

async function upload(
  options: UploadSnapOptions,
  counts: { screenshots: number; files: number },
): Promise<SnapSummary> {
  const sharded = options.shard !== undefined && options.shard.total > 1;
  const parallel = options.parallel === true && !sharded;
  if (options.screenshots.length === 0 && !sharded && !parallel) {
    return { status: 'empty', ...counts };
  }
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
    return { status: 'disabled', ...counts };
  }
  if (!resolution.ok) return failed(logger, resolution.problems.join('; '));
  const { config } = resolution;

  const ci = detectSnapCiSource(env);
  const commit = ci.headCommit?.toLowerCase();
  if (commit === undefined || !FULL_COMMIT.test(commit)) {
    throw new SnapProblem('the commit must be a full 40-character SHA: set PROBARA_COMMIT');
  }
  if (ci.branch === undefined) {
    throw new SnapProblem('the branch is not known: set PROBARA_BRANCH');
  }
  const { shard } = options;
  const split = shard !== undefined && shard.total > 1;
  // Only the shards of a run share the CI's nonce: two whole jobs of one CI run are two builds.
  const nonce = split || parallel ? snapNonceOf(options.nonce, env) : options.nonce;
  if (parallel && nonce === undefined) {
    throw new SnapProblem(
      'a run split across machines needs a nonce its machines share, and this CI gives none: set one (PROBARA_SNAP_NONCE in a reporter) to the same value on every machine',
    );
  }
  if (split && nonce === undefined) {
    throw new SnapProblem(
      'a sharded run needs a nonce its shards share, and this CI gives none: set one (PROBARA_SNAP_NONCE in a reporter) to the same value in every shard',
    );
  }
  if (options.screenshots.length > MAX_SCREENSHOTS_PER_SHARD) {
    throw new SnapProblem(
      `a job sends at most ${MAX_SCREENSHOTS_PER_SHARD} screenshots: this one took ${options.screenshots.length}`,
    );
  }
  const prepared: Prepared[] = [];
  const uploader = toolOf(options.sdk) ?? DEFAULT_SDK;
  for (const input of options.screenshots) prepared.push(await prepare(input, uploader));
  checkIdentities(prepared);
  const parentCommits = await snapParentCommits({
    cwd: options.cwd ?? process.cwd(),
    commit,
    branch: ci.branch,
    baseBranch: ci.baseBranch,
    logger,
  });

  const bytesByDigest = new Map(prepared.map(({ entry, bytes }) => [entry.sha256, bytes]));
  const name = options.buildName;
  const body: CreateSnapBuildRequest = {
    ...(name === undefined ? {} : { name }),
    commit,
    branch: ci.branch,
    ...(ci.baseBranch === undefined ? {} : { baseBranch: ci.baseBranch }),
    ...(ci.pullRequestNumber === undefined ? {} : { pullRequestNumber: ci.pullRequestNumber }),
    ...(ci.provider === undefined ? {} : { ciProvider: ci.provider }),
    // A build without a nonce is finalized by its one shard; with one, by its shard total, or by
    // an explicit finalize when its machines send no total.
    ...(nonce === undefined
      ? {}
      : parallel
        ? { ciNonce: nonce }
        : { ciNonce: nonce, shard: shard ?? { index: 0, total: 1 } }),
    ...(options.runUlid === undefined ? {} : { runUlid: options.runUlid }),
    ...(parentCommits === undefined ? {} : { parentCommits }),
    files: [...bytesByDigest.keys()].map((sha256) => ({ sha256 })),
  };

  const client: ProbaraClient = clientOf(config, options, logger);
  const { projectId } = config;
  const created = await client.createSnapBuild(projectId, body, {
    idempotencyKey: createIdempotencyKey(),
  });
  const { build, shardUlid } = created;

  const uploadFiles = (digests: readonly string[]) =>
    inParallel(digests, options.concurrency ?? DEFAULT_CONCURRENCY, async (sha256) => {
      const bytes = bytesByDigest.get(sha256);
      if (bytes === undefined) return;
      const content = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
      await client.uploadSnapFile(projectId, build.ulid, sha256, content);
      counts.files += 1;
    });
  const finalize = () =>
    client.finalizeSnapShard(
      projectId,
      build.ulid,
      shardUlid,
      { screenshots: prepared.map(({ entry }) => entry) },
      { idempotencyKey: createIdempotencyKey() },
    );

  await uploadFiles(created.missingFiles);
  let finalized: SnapBuild;
  try {
    finalized = await finalize();
  } catch (error) {
    const missing = missingFilesOf(error);
    if (missing === undefined) throw error;
    logger.debug(`Probara no longer holds ${missing.length} of the files: uploading them again`);
    await uploadFiles(missing);
    finalized = await finalize();
  }

  counts.screenshots = prepared.length;
  if (prepared.length === 0 && parallel) {
    logger.debug(
      `Joined the Snap build #${finalized.number} without screenshots: ${finalized.url}`,
    );
  } else if (prepared.length === 0 && shard !== undefined) {
    logger.debug(
      `Finalized the shard ${shard.index + 1} of ${shard.total} of the Snap build #${finalized.number} without screenshots: ${finalized.url}`,
    );
  }
  const sent = `${prepared.length} ${prepared.length === 1 ? 'screenshot' : 'screenshots'}`;
  const fresh = `${counts.files} new ${counts.files === 1 ? 'file' : 'files'}`;
  if (prepared.length > 0) {
    const waits = parallel ? ', which waits for "probara snap finalize"' : '';
    logger.info(
      `Sent ${sent} to the Snap build #${finalized.number} (${fresh})${waits}: ${finalized.url}`,
    );
  }
  return {
    status: 'uploaded',
    build: {
      ulid: finalized.ulid,
      number: finalized.number,
      url: finalized.url,
      jobStatus: finalized.jobStatus,
    },
    ...counts,
  };
}
