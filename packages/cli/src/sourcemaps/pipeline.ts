/**
 * The steps `probara sourcemaps inject` and `upload` take for each built file, shared with the
 * bundler plugins: inject a debug ID, read the maps that carry one, and upload them.
 */
import { readFile, writeFile } from 'node:fs/promises';
import type { BuiltFile } from './built-file.js';
import { debugIdOf, inject, injectedDebugIdOf, type SourceMapJson } from './inject.js';
import { uploadSourceMap, type UploadTarget } from './upload.js';

/** Maps uploaded at the same time. */
export const UPLOAD_CONCURRENCY = 4;

export type InjectOutcome = 'injected' | 'already-injected' | 'failed';

export interface InjectEntry {
  file: string;
  map: string;
  debugId?: string;
  outcome: InjectOutcome;
  error?: string;
}

export function parseMap(text: string): SourceMapJson {
  const value = JSON.parse(text) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('it is not a JSON object');
  }
  return value as SourceMapJson;
}

export function reasonOf(error: unknown): string {
  return error instanceof SyntaxError
    ? 'it is not valid JSON'
    : error instanceof Error
      ? error.message
      : String(error);
}

/** Injects a debug ID (and `release`, when given) into `file` and its map, unless it has one. */
export async function injectBuiltFile(
  file: BuiltFile,
  { dryRun, release }: { dryRun: boolean; release?: string | undefined },
): Promise<InjectEntry> {
  const entry = { file: file.shown, map: file.mapShown };
  const code = await readFile(file.path, 'utf8');
  const existing = injectedDebugIdOf(code);
  if (existing !== undefined) return { ...entry, debugId: existing, outcome: 'already-injected' };
  const mapText = await readFile(file.mapPath, 'utf8');
  const debugId = debugIdOf(code, mapText);
  let injected;
  try {
    injected = inject(code, parseMap(mapText), debugId, release);
  } catch (error) {
    return {
      ...entry,
      outcome: 'failed',
      error: `${file.mapShown} is not a source map (${reasonOf(error)}): ${file.shown} was left as it was`,
    };
  }
  if (!dryRun) {
    await writeFile(file.mapPath, JSON.stringify(injected.map));
    await writeFile(file.path, injected.code);
  }
  return { ...entry, debugId, outcome: 'injected' };
}

export interface UploadEntry {
  file: string;
  map: string;
  debugId: string;
  url: string;
  bytes: Uint8Array;
}

export interface Unreadable {
  file: string;
  map: string;
  error: string;
}

export type FailedUpload = ReturnType<typeof describeUpload> & { error: string };

export const describeUpload = ({ file, map, debugId, url }: UploadEntry) => ({
  file,
  map,
  debugId,
  url,
});

/** The maps of `files` that carry a debug ID; the others are reported and left out. */
export async function mapsToUpload(
  files: readonly BuiltFile[],
  prefix: string,
  warn: (message: string) => void,
): Promise<{ maps: UploadEntry[]; unreadable: Unreadable[] }> {
  const maps: UploadEntry[] = [];
  const unreadable: Unreadable[] = [];
  for (const file of files) {
    const bytes = await readFile(file.mapPath);
    let debugId: unknown;
    try {
      debugId = parseMap(new TextDecoder().decode(bytes)).debug_id;
    } catch (error) {
      unreadable.push({
        file: file.shown,
        map: file.mapShown,
        error: `${file.mapShown} is not a source map (${reasonOf(error)})`,
      });
      continue;
    }
    if (typeof debugId !== 'string' || debugId === '') {
      warn(
        `${file.mapShown} has no debug ID, so it was left out: run probara sourcemaps inject first`,
      );
      continue;
    }
    const url = `${prefix.replace(/\/+$/, '')}/${file.urlPath}`;
    maps.push({ file: file.shown, map: file.mapShown, debugId, url, bytes });
  }
  return { maps, unreadable };
}

async function eachAtMost<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Uploads `maps`, `UPLOAD_CONCURRENCY` at a time, telling each outcome as it comes; the uploaded
 * and the failed ones come back in the order of `files`.
 */
export async function uploadMaps(
  files: readonly BuiltFile[],
  maps: readonly UploadEntry[],
  target: UploadTarget,
  report: {
    uploaded: (map: UploadEntry) => void;
    failed: (map: UploadEntry, error: string) => void;
  },
): Promise<{ uploaded: UploadEntry[]; failed: FailedUpload[] }> {
  const uploaded: UploadEntry[] = [];
  const failed: FailedUpload[] = [];
  await eachAtMost(maps, UPLOAD_CONCURRENCY, async (map) => {
    const outcome = await uploadSourceMap(target, map.debugId, map.url, map.bytes);
    if (outcome.ok) {
      uploaded.push(map);
      report.uploaded(map);
    } else {
      failed.push({ ...describeUpload(map), error: outcome.error });
      report.failed(map, outcome.error);
    }
  });
  const order = (entry: { file: string }) => files.findIndex((file) => file.shown === entry.file);
  uploaded.sort((a, b) => order(a) - order(b));
  failed.sort((a, b) => order(a) - order(b));
  return { uploaded, failed };
}
