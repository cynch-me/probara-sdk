/**
 * `probara vis record --cdp <endpoint>`: records a page of a browser an agent drives, over the
 * Chrome DevTools Protocol, as a Vis of kind `replay`. The capture engine's script build is
 * injected into the page and into every document it navigates to; it streams the DOM replay and
 * the console, network and user event streams back through a binding until the recording stops
 * (a signal, `--duration`, the page closing or the plan's longest recording, read from Probara
 * before the recording starts). The Vis is then created and uploaded through the path
 * `vis create` takes. The browser receives only the capture script.
 */
import { randomBytes } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createIdempotencyKey,
  ProbaraApiError,
  type CreateVisRequest,
  type ProbaraClient,
  type Vis,
} from '@probara/core';
import { gzipNdjson } from '@probara/vis-capture';
import { EXIT_REPORTING_FAILED, EXIT_USAGE } from '../exit-codes.js';
import { stringOf, UsageError, type ParsedCommandLine } from '../options.js';
import { CdpError, connectCdp, isCdpUrl, resolveEndpoint, type CdpConnection } from '../vis/cdp.js';
import { PAGE_HANDLE, pageScript, readEngineScripts } from '../vis/page-script.js';
import {
  createRecordingBuffer,
  redactPageUrl,
  type RecordingBuffer,
  type RecordingOutput,
} from '../vis/recording.js';
import type { CommandContext, CommandIO } from './context.js';
import { plural } from './reporting.js';
import { createAndUpload, metadataOf, mib, uploadParts, uploadStreams } from './vis-create.js';
import { isProbaraError, prepareVis } from './vis.js';

const HELP = 'probara vis record';
/**
 * The longest recording when the plan's cannot be read: the largest plan's (60 minutes). When
 * Probara then refuses a longer recording, it says the limit, and the Vis keeps the recording's
 * first minutes up to it.
 */
export const MAX_RECORDING_MS = 60 * 60_000;
/**
 * How long the command waits for the plan's longest recording before it records with
 * {@link MAX_RECORDING_MS}: a slow Probara never delays the start by a whole `--timeout`.
 */
export const PLAN_READ_MS = 3000;
/** The longest delay a timer holds (2^31 - 1 ms): a longer one would fire at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;
const TITLE_MAX_LENGTH = 200;
/** How long the CLI tries to delete the pending Vis once a signal stopped its upload. */
export const CLEANUP_MS = 5000;
const NDJSON = 'application/x-ndjson';

type StopReason = 'closed' | 'duration' | 'limit' | 'full' | `SIG${string}`;

/** A page of the browser, as `Target.getTargets` lists it. */
interface PageTarget {
  targetId: string;
  url: string;
  title: string;
}

function pageLines(pages: readonly PageTarget[]): string[] {
  return pages.map((page) =>
    `  ${page.targetId}  ${redactPageUrl(page.url)}  ${page.title}`.trimEnd(),
  );
}

/** The page `--target` names (by id, or part of its URL), or the only one; logs why not. */
function choosePage(
  pages: readonly PageTarget[],
  target: string | undefined,
  { logger }: CommandContext,
): PageTarget | undefined {
  const refuse = (message: string, listed: readonly PageTarget[] = pages): undefined => {
    logger.error(message);
    for (const line of pageLines(listed)) logger.error(line);
  };
  if (target === undefined) {
    if (pages.length === 1) return pages[0];
    if (pages.length === 0) {
      logger.error('The browser has no page to record: open one first');
      return undefined;
    }
    refuse(
      `The browser has ${String(pages.length)} pages: pass --target with the id of one, or part of its URL`,
    );
    return undefined;
  }
  const exact = pages.find((page) => page.targetId === target);
  if (exact !== undefined) return exact;
  const matches = pages.filter((page) => page.url.includes(target));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) refuse(`No page matches --target "${target}". The pages:`);
  else {
    refuse(
      `${String(matches.length)} pages match --target "${target}": pass the id of one`,
      matches,
    );
  }
  return undefined;
}

function describeStop(
  reason: StopReason,
  durationSeconds: number | undefined,
  planMs: number | undefined,
): string {
  if (reason === 'closed') return 'The page closed: the recording ends';
  if (reason === 'duration') {
    return `Reached --duration (${String(durationSeconds)} s): the recording ends`;
  }
  if (reason === 'limit') {
    return planMs === undefined
      ? 'Reached the longest recording, 60 minutes: the recording ends'
      : `Reached the plan's longest recording, ${plural(planMs / 60_000, 'minute')}: the recording ends`;
  }
  if (reason === 'full') return 'The replay reached 1 GiB: the recording ends';
  return `${reason}: the recording ends`;
}

/**
 * Calls `fire` once `ms` have passed, waiting in steps a timer holds; never when `ms` is
 * infinite. Returns the function that cancels it.
 */
function startTimer(ms: number, fire: () => void): () => void {
  if (!Number.isFinite(ms)) return () => undefined;
  let remaining = ms;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const step = () => {
    const delay = Math.min(remaining, MAX_TIMER_MS);
    remaining -= delay;
    timer = setTimeout(remaining > 0 ? step : fire, delay);
  };
  step();
  return () => {
    clearTimeout(timer);
  };
}

/**
 * The plan's longest recording in milliseconds (`Infinity` when the plan has no limit), read from
 * Probara once, never retried, within {@link PLAN_READ_MS}; `undefined` when it cannot be read in
 * time or is not answered, so the recording keeps {@link MAX_RECORDING_MS}, or when `stop` aborted
 * the read.
 */
async function readPlanLimitMs(
  once: ProbaraClient,
  { logger }: CommandContext,
  stop: AbortSignal,
): Promise<number | undefined> {
  const bound = new AbortController();
  const timer = setTimeout(() => {
    bound.abort(new Error(`no answer within ${String(PLAN_READ_MS / 1000)} s`));
  }, PLAN_READ_MS);
  let minutes: number | undefined;
  try {
    const signal = AbortSignal.any([stop, bound.signal]);
    minutes = (await once.getVisSettings({ signal })).limits?.recordingMaxMinutes;
  } catch (error) {
    if (stop.aborted) return undefined;
    const reason = bound.signal.aborted ? (bound.signal.reason as Error) : error;
    if (!bound.signal.aborted && !isProbaraError(error)) throw error;
    logger.debug(`Could not read the plan's longest recording: ${(reason as Error).message}`);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
  if (minutes === undefined || minutes <= 0) {
    logger.debug("Probara did not answer the plan's longest recording");
    return undefined;
  }
  const ms = minutes * 60_000;
  // Unlimited is Number.MAX_SAFE_INTEGER minutes: past what milliseconds can count, no limit.
  return Number.isSafeInteger(ms) ? ms : Infinity;
}

/**
 * The stop signals of one run (Ctrl+C, SIGTERM). While the page records, a signal ends the
 * recording. Once the recording ended, a signal stops the upload through its cleanup (see
 * {@link createUploadGuard}), and the command lets go of the signals: the next one is the
 * terminal's, which ends the process at once.
 */
function createSignals(io: CommandIO, interrupt: (signal: string) => void) {
  let stopRecording: ((signal: string) => void) | undefined;
  let stoppedBySignal = false;
  let unsubscribe: (() => void) | undefined;
  const release = () => {
    unsubscribe?.();
    unsubscribe = undefined;
  };
  return {
    /** The recording runs: a signal calls `finish`. */
    recording(finish: (signal: string) => void): void {
      stopRecording = finish;
      unsubscribe ??= io.stopSignals?.((signal) => {
        if (stopRecording !== undefined) {
          const stop = stopRecording;
          stopRecording = undefined;
          stoppedBySignal = true;
          stop(signal);
          return;
        }
        release();
        interrupt(`${signal}${stoppedBySignal ? ' again' : ''}`);
      });
    },
    /** The recording ended: a signal now stops the upload. */
    recorded(): void {
      stopRecording = undefined;
    },
    release,
  };
}

/**
 * The fetch and the waits of the upload, which a signal can stop: the requests in flight are
 * cancelled, every later one fails at once (so core's retries end at once), except the deletion of
 * the pending Vis, which is tried within {@link CLEANUP_MS}.
 */
function createUploadGuard(io: CommandIO, context: CommandContext) {
  const base = io.fetch ?? globalThis.fetch;
  const upload = new AbortController();
  let deadline: AbortSignal | undefined;
  const merged = (signal: AbortSignal | null | undefined, extra: AbortSignal) =>
    signal === undefined || signal === null ? extra : AbortSignal.any([signal, extra]);
  const fetchGuarded: typeof fetch = (input, init = {}) => {
    if (!upload.signal.aborted)
      return base(input, { ...init, signal: merged(init.signal, upload.signal) });
    const url = new URL(input instanceof Request ? input.url : String(input));
    const deletesVis =
      (init.method ?? 'GET').toUpperCase() === 'DELETE' &&
      /^\/api\/v1\/vises\/[^/]+$/.test(url.pathname);
    if (!deletesVis) return Promise.reject(upload.signal.reason as Error);
    deadline ??= AbortSignal.timeout(CLEANUP_MS);
    return base(input, { ...init, signal: merged(init.signal, deadline) });
  };
  const wait =
    io.sleep ??
    ((ms: number, signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', cancel);
          resolve();
        }, ms);
        const cancel = () => {
          clearTimeout(timer);
          reject(signal?.reason as Error);
        };
        signal?.addEventListener('abort', cancel, { once: true });
      }));
  /** Read anew each time: a signal may arrive while a wait runs. */
  const stopped = (): boolean => upload.signal.aborted;
  const sleepGuarded = async (ms: number, signal?: AbortSignal): Promise<void> => {
    if (stopped()) return;
    try {
      await wait(ms, merged(signal, upload.signal));
    } catch (error) {
      // A wait cut short by the signal ends at once; the caller's own abort still throws.
      if (!stopped() || signal?.aborted === true) throw error;
    }
  };
  return {
    context: { ...context, io: { ...io, fetch: fetchGuarded, sleep: sleepGuarded } },
    /** Aborts once a signal stopped the upload: the requests it is given end, never retried. */
    signal: upload.signal,
    interrupt(signal: string): void {
      if (upload.signal.aborted) return;
      const next = signal.endsWith(' again') ? 'a third one' : 'another one';
      context.logger.warn(
        `${signal}: the upload stops and the pending Vis is deleted; ${next} quits at once`,
      );
      upload.abort(new Error(`stopped by ${signal}`));
    },
  };
}

interface Recorded {
  buffer: RecordingBuffer;
  page: { url: string; title: string };
  /** The longest recording kept: the plan's, or `--duration` when shorter. */
  capMs: number;
}

/**
 * Attaches to the page, reads the plan's longest recording with `readPlanMs` (a signal meanwhile
 * ends the command before anything is injected or created), injects the capture script and
 * collects until the recording stops. Resolves what was recorded, or the exit code of a
 * recording that could not start (logged).
 */
async function recordPage(
  endpoint: string,
  target: string | undefined,
  durationSeconds: number | undefined,
  readPlanMs: (stop: AbortSignal) => Promise<number | undefined>,
  dir: string,
  context: CommandContext,
  signals: ReturnType<typeof createSignals>,
): Promise<Recorded | number> {
  const { logger } = context;
  let connection: CdpConnection;
  let resolved;
  try {
    resolved = await resolveEndpoint(endpoint);
    connection = await connectCdp(resolved.url);
  } catch (error) {
    if (!(error instanceof CdpError)) throw error;
    logger.error(error.message);
    return EXIT_REPORTING_FAILED;
  }
  try {
    let sessionId: string | undefined;
    let targetId: string | undefined;
    let page = { url: '', title: '' };
    if (resolved.kind === 'browser') {
      await connection.send('Target.setDiscoverTargets', { discover: true });
      const { targetInfos } = await connection.send('Target.getTargets');
      const pages = (Array.isArray(targetInfos) ? targetInfos : [])
        .filter(
          (info): info is Record<string, unknown> => typeof info === 'object' && info !== null,
        )
        .filter((info) => info.type === 'page' && typeof info.targetId === 'string')
        .map((info) => ({
          targetId: String(info.targetId),
          url: typeof info.url === 'string' ? info.url : '',
          title: typeof info.title === 'string' ? info.title : '',
        }));
      const chosen = choosePage(pages, target, context);
      if (chosen === undefined) return EXIT_USAGE;
      targetId = chosen.targetId;
      page = { url: chosen.url, title: chosen.title };
      const attached = await connection.send('Target.attachToTarget', {
        targetId,
        flatten: true,
      });
      if (typeof attached.sessionId !== 'string') {
        throw new CdpError('The browser did not attach to the page');
      }
      sessionId = attached.sessionId;
    }

    const starting = new AbortController();
    let startSignal: string | undefined;
    signals.recording((signal) => {
      startSignal = signal;
      starting.abort(new Error(`stopped by ${signal}`));
    });
    const planMs = await readPlanMs(starting.signal);
    if (startSignal !== undefined) {
      logger.error(
        `${startSignal}: the recording did not start, and nothing was created on Probara`,
      );
      return EXIT_REPORTING_FAILED;
    }
    const capMs = Math.min(planMs ?? MAX_RECORDING_MS, (durationSeconds ?? Infinity) * 1000);
    const buffer = createRecordingBuffer({ replayPath: join(dir, 'replay.ndjson'), capMs });
    const binding = `__probaraVis${randomBytes(8).toString('hex')}`;
    const source = pageScript(binding, await readEngineScripts());
    const send = (method: string, params: Record<string, unknown> = {}) =>
      connection.send(method, params, sessionId);

    let finish: (reason: StopReason) => void = () => undefined;
    const stopped = new Promise<StopReason>((resolve) => {
      finish = resolve;
    });
    const unsubscribeEvents = connection.onEvent(({ method, params, sessionId: from }) => {
      if (from !== sessionId) {
        if (method === 'Target.detachedFromTarget' && params.sessionId === sessionId) {
          finish('closed');
        } else if (method === 'Target.targetDestroyed' && params.targetId === targetId) {
          finish('closed');
        }
        return;
      }
      if (method === 'Runtime.bindingCalled' && params.name === binding) {
        if (typeof params.payload === 'string') buffer.accept(params.payload);
        if (buffer.full) finish('full');
      } else if (method === 'Inspector.detached') {
        finish('closed');
      }
    });
    void connection.closed.then(() => {
      finish('closed');
    });

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Runtime.addBinding', { name: binding });
    const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source });
    const url = redactPageUrl(page.url);
    const shown = page.title === '' ? url : `"${page.title}" (${url})`;
    logger.info(
      `Recording ${shown === '' ? 'the page' : shown}: stop with Ctrl+C, or close the page`,
    );
    const evaluated = await send('Runtime.evaluate', { expression: source });
    const failure = evaluated.exceptionDetails as
      { text?: unknown; exception?: { description?: unknown } } | undefined;
    if (failure !== undefined) {
      const description = failure.exception?.description ?? failure.text;
      throw new CdpError(
        `the capture script failed in the page (${typeof description === 'string' ? (description.split('\n')[0] ?? '') : 'no description'})`,
      );
    }

    const cancelTimer = startTimer(capMs, () => {
      finish(
        durationSeconds !== undefined && durationSeconds * 1000 <= capMs ? 'duration' : 'limit',
      );
    });
    signals.recording((signal) => {
      finish(signal as StopReason);
    });
    const reason = await stopped;
    cancelTimer();
    signals.recorded();
    logger.info(describeStop(reason, durationSeconds, planMs));

    if (reason !== 'closed') {
      // The page sends what it still holds, stops its captures, and new documents are left alone.
      await send('Runtime.evaluate', { expression: `window[${PAGE_HANDLE}]?.stop()` }).catch(
        () => ({}),
      );
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => ({}));
      await send('Runtime.removeBinding', { name: binding }).catch(() => ({}));
      if (sessionId !== undefined) {
        await connection.send('Target.detachFromTarget', { sessionId }).catch(() => ({}));
      }
    }
    unsubscribeEvents();
    buffer.close();
    return { buffer, page, capMs };
  } catch (error) {
    if (!(error instanceof CdpError)) throw error;
    logger.error(`The recording failed: ${error.message}`);
    return EXIT_REPORTING_FAILED;
  } finally {
    connection.close();
  }
}

/** The plan's limit, from a refusal of a recording that is too long. */
function planLimitMs(error: unknown): number | undefined {
  if (!(error instanceof ProbaraApiError) || error.status !== 422) return undefined;
  const details = error.details as { reason?: unknown; recordingMaxMinutes?: unknown } | undefined;
  const minutes = details?.recordingMaxMinutes;
  if (details?.reason !== 'recording_too_long' || !Number.isInteger(minutes)) return undefined;
  return (minutes as number) > 0 ? (minutes as number) * 60_000 : undefined;
}

/**
 * Uploads the replay and the streams of `output`, and finalizes the Vis with its length; `signal`
 * stops it at once.
 */
async function uploadRecording(
  client: ProbaraClient,
  vis: Vis,
  output: RecordingOutput,
  context: CommandContext,
  signal: AbortSignal,
): Promise<Vis> {
  await uploadParts(
    client,
    vis,
    { kind: 'replay', contentType: NDJSON, contentEncoding: 'gzip' },
    await openAsBlob(output.replayPath),
    context,
    signal,
  );
  await uploadStreams(client, vis, output.streams, signal);
  return client.finalizeVis(
    vis.ulid,
    { durationMs: output.durationMs },
    { idempotencyKey: createIdempotencyKey(), signal },
  );
}

export async function recordVisCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const { values, positionals } = parsed;
  const { logger } = context;
  const [unexpected] = positionals;
  if (unexpected !== undefined) throw new UsageError(`Unexpected argument "${unexpected}"`, HELP);
  const endpoint = stringOf(values, 'cdp');
  if (endpoint === undefined) {
    throw new UsageError(
      'Missing --cdp: the debugging endpoint of the browser, such as http://127.0.0.1:9222, or a WebSocket debugger URL',
      HELP,
    );
  }
  if (!isCdpUrl(endpoint)) {
    throw new UsageError(
      '--cdp must be an http, https, ws or wss URL, such as http://127.0.0.1:9222',
      HELP,
    );
  }
  const target = stringOf(values, 'target');
  if (target !== undefined && /^wss?:\/\/[^/]+\/devtools\/page\//.test(endpoint)) {
    throw new UsageError(
      "--target picks a page of a browser endpoint: --cdp already names one page's debugger",
      HELP,
    );
  }
  const duration = values.get('duration');
  if (duration === 0)
    throw new UsageError('--duration must be a positive whole number of seconds', HELP);
  const durationSeconds = typeof duration === 'number' ? duration : undefined;
  const metadataValue = values.get('metadata');
  const metadata = metadataOf(Array.isArray(metadataValue) ? metadataValue : [], HELP);

  // The client uploads through a fetch a signal can stop, and the signals reach it from here on.
  const guard = createUploadGuard(context.io, context);
  const signals = createSignals(context.io, (signal) => {
    guard.interrupt(signal);
  });
  const prepared = await prepareVis('vis record', parsed, guard.context, clientName);
  if (!prepared.ready) return prepared.exitCode;
  const { session } = prepared;

  const dir = await mkdtemp(join(tmpdir(), 'probara-vis-record-'));
  try {
    const recorded = await recordPage(
      endpoint,
      target,
      durationSeconds,
      (stop) => readPlanLimitMs(session.once, context, stop),
      dir,
      context,
      signals,
    );
    if (typeof recorded === 'number') return recorded;
    const { buffer, page, capMs } = recorded;
    if (buffer.ignored > 0) {
      logger.warn(
        `Ignored ${plural(buffer.ignored, 'message')} from the page that were not valid capture data`,
      );
    }
    for (const [stream, label] of [
      ['console', 'console'],
      ['network', 'network'],
      ['events', 'user event'],
    ] as const) {
      const dropped = buffer.dropped(stream);
      if (dropped > 0) {
        logger.warn(`Kept the newest ${label} entries: ${String(dropped)} older ones were dropped`);
      }
    }
    const startTs = buffer.startTs;
    if (startTs === undefined || buffer.replayEvents === 0) {
      logger.error('Nothing was captured: no Vis was created');
      return EXIT_REPORTING_FAILED;
    }
    const output = await buffer.output(capMs, join(dir, 'replay.ndjson.gz'));
    const counts = [plural(output.replayEvents, 'replay event')];
    for (const stream of output.streams) {
      counts.push(
        stream.kind === 'console'
          ? plural(stream.count, 'console message')
          : stream.kind === 'network'
            ? plural(stream.count, 'request')
            : plural(stream.count, 'action'),
      );
    }
    logger.info(`Recorded ${(output.durationMs / 1000).toFixed(1)} s: ${counts.join(', ')}`);

    const environment = buffer.environment;
    const pageUrl =
      environment?.pageUrl ??
      (/^https?:\/\//.test(page.url) && page.url.length <= 2048
        ? redactPageUrl(page.url)
        : undefined);
    const pageTitle =
      environment?.pageTitle ??
      (page.title.trim() === '' ? undefined : page.title.trim().slice(0, 500));
    const title = (
      stringOf(values, 'title') ??
      pageTitle ??
      (pageUrl === undefined ? 'Browser recording' : `Recording of ${new URL(pageUrl).host}`)
    ).slice(0, TITLE_MAX_LENGTH);
    const description = stringOf(values, 'description');
    const folder = stringOf(values, 'folder');
    const body: CreateVisRequest = {
      title,
      kind: 'replay',
      source: 'cli',
      capturedAt: startTs,
      ...(description === undefined ? {} : { description }),
      ...(folder === undefined ? {} : { folderUlid: folder }),
      ...(values.get('private') === true ? { accessMode: 'private' as const } : {}),
      ...(pageUrl === undefined ? {} : { pageUrl }),
      ...(pageTitle === undefined ? {} : { pageTitle }),
      ...(environment === undefined ? {} : { environment: environment.environment }),
      ...(metadata === undefined ? {} : { metadata }),
    };

    const { client } = session;
    return await createAndUpload(
      session,
      context,
      body,
      `the replay (${mib(output.replayBytes)})`,
      async (created) => {
        try {
          return await uploadRecording(client, created, output, context, guard.signal);
        } catch (error) {
          const limitMs = planLimitMs(error);
          if (limitMs === undefined || limitMs >= output.durationMs) throw error;
          const minutes = plural(limitMs / 60_000, 'minute');
          logger.warn(
            `The plan records at most ${minutes}: the Vis keeps the first ${minutes} of the recording`,
          );
          const cut = await buffer.output(limitMs, join(dir, 'replay-cut.ndjson.gz'));
          // A stream left with nothing past the cut is replaced by an empty one.
          const kinds = new Set(cut.streams.map((stream) => stream.kind));
          const emptied = await Promise.all(
            output.streams
              .filter((stream) => !kinds.has(stream.kind))
              .map(async (stream) => ({
                kind: stream.kind,
                count: 0,
                bytes: await gzipNdjson([]),
              })),
          );
          return uploadRecording(
            client,
            created,
            { ...cut, streams: [...cut.streams, ...emptied] },
            context,
            guard.signal,
          );
        }
      },
      guard.signal,
    );
  } finally {
    signals.release();
    await rm(dir, { recursive: true, force: true });
  }
}
