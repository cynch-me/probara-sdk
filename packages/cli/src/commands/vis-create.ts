/**
 * `probara vis create <file>`: an existing recording (MP4, WebM) or screenshot (PNG, JPEG, WebP)
 * uploaded as a new Vis, with the diagnostics of a Playwright trace when one is given. Everything
 * is read and checked before anything is sent; a Vis whose upload fails is deleted again.
 */
import { openAsBlob } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  createIdempotencyKey,
  type CreateVisRequest,
  type ProbaraClient,
  type Vis,
  type VisAssetKind,
} from '@probara/core';
import { gzipNdjson } from '@probara/vis-capture';
import { EXIT_OK, EXIT_REPORTING_FAILED, EXIT_USAGE } from '../exit-codes.js';
import { displayPath } from '../files.js';
import { stringOf, UsageError, type ParsedCommandLine } from '../options.js';
import { MEDIA_HEAD_BYTES, mediaOf, videoDurationMs, type Media } from '../vis/media.js';
import { readPlaywrightTrace, TraceError, type TraceDiagnostics } from '../vis/playwright-trace.js';
import type { CommandContext } from './context.js';
import { plural } from './reporting.js';
import { isProbaraError, logRefusal, prepareVis, visUrl, type VisSession } from './vis.js';

const HELP = 'probara vis create';
const MIB = 1024 * 1024;
/** Largest screenshot Probara stores (10 MiB). */
const MAX_IMAGE_BYTES = 10 * MIB;
/** Largest diagnostics stream Probara stores, compressed (32 MiB). */
const MAX_STREAM_BYTES = 32 * MIB;
const TITLE_MAX_LENGTH = 200;
const NDJSON = 'application/x-ndjson';

/** The file to upload, checked: what it is, how big, and the length of a video. */
interface Upload {
  path: string;
  shown: string;
  size: number;
  media: Media;
  durationMs?: number;
}

/** A compressed diagnostics stream, ready to upload. */
interface Stream {
  kind: Extract<VisAssetKind, 'console' | 'network' | 'events'>;
  count: number;
  bytes: Uint8Array<ArrayBuffer>;
}

/** `--metadata` pairs as a JSON object, split at the first `=`. */
export function metadataOf(
  pairs: readonly string[],
  help = HELP,
): Record<string, string> | undefined {
  if (pairs.length === 0) return undefined;
  const metadata = Object.create(null) as Record<string, string>;
  for (const pair of pairs) {
    const separator = pair.indexOf('=');
    const key = separator === -1 ? '' : pair.slice(0, separator).trim();
    if (key === '') {
      throw new UsageError('--metadata takes key=value pairs, such as build=1.42.0', help);
    }
    if (Object.hasOwn(metadata, key)) {
      throw new UsageError(`--metadata sets "${key}" twice`, help);
    }
    metadata[key] = pair.slice(separator + 1);
  }
  return { ...metadata };
}

function pageUrlOf(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError('--page-url must be an http or https URL', HELP);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError('--page-url must be an http or https URL', HELP);
  }
  return value;
}

/** A size as a reader takes it in: KiB under 1 MiB, then MiB. */
export function mib(bytes: number): string {
  if (bytes < MIB) return `${String(Math.ceil(bytes / 1024))} KiB`;
  return `${(bytes / MIB).toFixed(1)} MiB`;
}

/**
 * Reads what the file is and, for a video, its length. Logs and resolves an error message when
 * the file cannot be used.
 */
async function inspect(
  path: string,
  shown: string,
  durationOption: number | undefined,
): Promise<Upload | string> {
  let size: number;
  let head: Uint8Array;
  let handle;
  try {
    const info = await stat(path);
    if (!info.isFile()) return `${shown}: is not a file`;
    size = info.size;
    handle = await open(path, 'r');
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return `${shown}: could not be read (${typeof code === 'string' ? code : String(error)})`;
  }
  try {
    head = new Uint8Array(MEDIA_HEAD_BYTES);
    const { bytesRead } = await handle.read(head, 0, MEDIA_HEAD_BYTES, 0);
    const media = mediaOf(head.subarray(0, bytesRead));
    if (media === undefined) {
      return `${shown}: is not an MP4 or WebM video, nor a PNG, JPEG or WebP image`;
    }
    if (media.kind === 'screenshot') {
      if (size > MAX_IMAGE_BYTES) {
        return `${shown}: is ${mib(size)}, and a screenshot can be at most 10 MiB`;
      }
      return { path, shown, size, media };
    }
    const durationMs = durationOption ?? (await videoDurationMs(handle, size, media.contentType));
    if (durationMs === undefined) {
      return `${shown}: the file does not record the length of the video: pass --duration-ms`;
    }
    return { path, shown, size, media, durationMs };
  } finally {
    await handle.close();
  }
}

/** The diagnostics of a Playwright trace, compressed; an error message when it cannot be read. */
async function traceStreams(path: string, shown: string): Promise<Stream[] | string> {
  let archive: Buffer;
  try {
    archive = await readFile(path);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return `${shown}: could not be read (${typeof code === 'string' ? code : String(error)})`;
  }
  let diagnostics: TraceDiagnostics;
  try {
    diagnostics = readPlaywrightTrace(archive);
  } catch (error) {
    if (error instanceof TraceError) return `${shown}: is not a Playwright trace: ${error.message}`;
    throw error;
  }
  const streams: Stream[] = [];
  for (const kind of ['console', 'network', 'events'] as const) {
    const entries = diagnostics[kind];
    if (entries.length === 0) continue;
    const bytes = await gzipNdjson(entries);
    if (bytes.byteLength > MAX_STREAM_BYTES) {
      return `${shown}: its ${kind} stream is ${mib(bytes.byteLength)} compressed, and Probara stores at most 32 MiB`;
    }
    streams.push({ kind, count: entries.length, bytes });
  }
  return streams;
}

/**
 * Uploads `file` as the `kind` asset of `vis` in parts of the size Probara gives; the parts
 * sent are dropped again when one fails.
 */
export async function uploadParts(
  client: ProbaraClient,
  vis: Vis,
  asset: { kind: 'video' | 'replay'; contentType: string; contentEncoding?: 'gzip' },
  file: Blob,
  { logger }: CommandContext,
): Promise<void> {
  const session = await client.startVisUpload(
    vis.ulid,
    { ...asset, byteSize: file.size },
    { idempotencyKey: createIdempotencyKey() },
  );
  const parts = Math.max(1, Math.ceil(file.size / session.partSize));
  try {
    for (let number = 1; number <= parts; number += 1) {
      const start = (number - 1) * session.partSize;
      const part = file.slice(start, Math.min(start + session.partSize, file.size));
      await client.uploadVisPart(vis.ulid, session.uploadUlid, number, part);
      logger.debug(`Uploaded part ${String(number)} of ${String(parts)}`);
    }
    await client.completeVisUpload(vis.ulid, session.uploadUlid, {
      idempotencyKey: createIdempotencyKey(),
    });
  } catch (error) {
    // The parts sent are dropped with the upload; the Vis itself is deleted by the caller.
    await client
      .abortVisUpload(vis.ulid, session.uploadUlid, { idempotencyKey: createIdempotencyKey() })
      .catch(() => undefined);
    throw error;
  }
}

/** Uploads compressed diagnostics streams as the assets of `vis`. */
export async function uploadStreams(
  client: ProbaraClient,
  vis: Vis,
  streams: readonly { kind: 'console' | 'network' | 'events'; bytes: Uint8Array<ArrayBuffer> }[],
): Promise<void> {
  for (const stream of streams) {
    await client.putVisAsset(vis.ulid, stream.kind, new Blob([stream.bytes], { type: NDJSON }), {
      contentEncoding: 'gzip',
    });
  }
}

/**
 * Creates the Vis of `body`, uploads what `upload` sends and prints the Vis the way `vis create`
 * does. When the upload fails, the pending Vis is deleted again. Resolves the exit code.
 */
export async function createAndUpload(
  { client, config, json }: VisSession,
  context: CommandContext,
  body: CreateVisRequest,
  what: string,
  upload: (created: Vis) => Promise<Vis>,
): Promise<number> {
  const { logger, output } = context;
  let created: Vis;
  try {
    created = await client.createVis(body, { idempotencyKey: createIdempotencyKey() });
  } catch (error) {
    if (!isProbaraError(error)) throw error;
    logRefusal(error, context);
    return EXIT_REPORTING_FAILED;
  }
  logger.info(`Created ${created.displayId}: uploading ${what}`);

  let vis: Vis;
  try {
    vis = await upload(created);
  } catch (error) {
    if (!isProbaraError(error)) throw error;
    logger.error(error.message);
    try {
      await client.deleteVis(created.ulid, { idempotencyKey: createIdempotencyKey() });
      logger.info(`Deleted the pending ${created.displayId}: nothing was left behind`);
    } catch (cleanup) {
      if (!isProbaraError(cleanup)) throw cleanup;
      logger.error(
        `Could not delete the pending ${created.displayId} (${cleanup.message}): Probara deletes it seven days after its creation`,
      );
    }
    return EXIT_REPORTING_FAILED;
  }

  const url = visUrl(config, vis);
  logger.info(`Uploaded ${vis.displayId}: ${url}`);
  if (json) output.json({ ...vis, url });
  else output.line(`${vis.ulid} ${vis.displayId} ${url}`);
  return EXIT_OK;
}

/** Uploads the media of `vis` and its diagnostics, then finalizes it. */
async function uploadAll(
  client: ProbaraClient,
  vis: Vis,
  upload: Upload,
  streams: readonly Stream[],
  context: CommandContext,
): Promise<Vis> {
  const { media } = upload;
  if (media.kind === 'screenshot') {
    await client.putVisAsset(
      vis.ulid,
      'screenshot',
      await openAsBlob(upload.path, { type: media.contentType }),
    );
  } else {
    await uploadParts(
      client,
      vis,
      { kind: 'video', contentType: media.contentType },
      await openAsBlob(upload.path),
      context,
    );
  }
  await uploadStreams(client, vis, streams);
  return client.finalizeVis(
    vis.ulid,
    upload.durationMs === undefined ? {} : { durationMs: upload.durationMs },
    { idempotencyKey: createIdempotencyKey() },
  );
}

export async function createVisCommand(
  parsed: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const { values, positionals } = parsed;
  const { io, logger } = context;
  const [target, extra] = positionals;
  if (target === undefined) {
    throw new UsageError(
      'Missing the file to upload: an MP4 or WebM video, or a PNG, JPEG or WebP screenshot',
      HELP,
    );
  }
  if (extra !== undefined) {
    throw new UsageError(`One file per Vis: got ${String(positionals.length)}`, HELP);
  }
  const durationOption = values.get('duration-ms');
  if (durationOption === 0) {
    throw new UsageError('--duration-ms must be a positive whole number', HELP);
  }
  const tracePath = stringOf(values, 'playwright-trace');
  const metadataValue = values.get('metadata');
  const metadata = metadataOf(Array.isArray(metadataValue) ? metadataValue : []);
  const pageUrl = pageUrlOf(stringOf(values, 'page-url'));
  const path = resolve(io.cwd, target);
  const shown = displayPath(path, io.cwd);

  let upload: Upload | undefined;
  let streams: Stream[] = [];
  const prepared = await prepareVis('vis create', parsed, context, clientName, async () => {
    const inspected = await inspect(
      path,
      shown,
      typeof durationOption === 'number' ? durationOption : undefined,
    );
    if (typeof inspected === 'string') {
      logger.error(inspected);
      return EXIT_USAGE;
    }
    if (inspected.media.kind === 'screenshot') {
      if (durationOption !== undefined) {
        throw new UsageError('--duration-ms is the length of a video: a screenshot has none', HELP);
      }
      if (tracePath !== undefined) {
        throw new UsageError(
          '--playwright-trace goes with a video: a screenshot has no timeline to sync it to',
          HELP,
        );
      }
    }
    if (tracePath !== undefined) {
      const traceFile = resolve(io.cwd, tracePath);
      const read = await traceStreams(traceFile, displayPath(traceFile, io.cwd));
      if (typeof read === 'string') {
        logger.error(read);
        logger.error('Nothing was sent: the video is not uploaded without its diagnostics.');
        return EXIT_USAGE;
      }
      streams = read;
    }
    upload = inspected;
    return undefined;
  });
  if (!prepared.ready || upload === undefined)
    return prepared.ready ? EXIT_USAGE : prepared.exitCode;
  const { client } = prepared.session;
  const checked: Upload = upload;

  const title = stringOf(values, 'title') ?? basename(path).slice(0, TITLE_MAX_LENGTH);
  const description = stringOf(values, 'description');
  const folder = stringOf(values, 'folder');
  const body: CreateVisRequest = {
    title,
    kind: checked.media.kind,
    source: 'cli',
    ...(description === undefined ? {} : { description }),
    ...(folder === undefined ? {} : { folderUlid: folder }),
    ...(values.get('private') === true ? { accessMode: 'private' as const } : {}),
    ...(pageUrl === undefined ? {} : { pageUrl }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(checked.durationMs === undefined ? {} : { durationMs: checked.durationMs }),
  };
  if (streams.length > 0) {
    const counts = streams.map((stream) =>
      stream.kind === 'console'
        ? plural(stream.count, 'console message')
        : stream.kind === 'network'
          ? plural(stream.count, 'request')
          : plural(stream.count, 'action'),
    );
    logger.info(`Diagnostics from the trace: ${counts.join(', ')}`);
  }

  return createAndUpload(
    prepared.session,
    context,
    body,
    `${checked.shown} (${mib(checked.size)})`,
    (created) => uploadAll(client, created, checked, streams, context),
  );
}
