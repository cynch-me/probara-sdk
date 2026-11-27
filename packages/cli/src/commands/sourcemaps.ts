/**
 * `probara sourcemaps inject` gives the built JavaScript files and their source maps a debug ID;
 * `probara sourcemaps upload` sends the maps with one to Probara for a release, so the error
 * monitoring SDKs' events of those files are symbolicated by the debug IDs they carry.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolveSetup } from '../configuration.js';
import { EXIT_OK, EXIT_REPORTING_FAILED, EXIT_USAGE } from '../exit-codes.js';
import { stringOf, toCoreOptions, UsageError, type ParsedCommandLine } from '../options.js';
import { builtFilesUnder, type BuiltFile } from '../sourcemaps/files.js';
import { debugIdOf, inject, injectedDebugIdOf, type SourceMapJson } from '../sourcemaps/inject.js';
import { uploadSourceMap, type UploadTarget } from '../sourcemaps/upload.js';
import type { CommandContext } from './context.js';
import { plural } from './reporting.js';

/** Maps uploaded at the same time. */
const UPLOAD_CONCURRENCY = 4;
const DEFAULT_URL_PREFIX = '~/';

type InjectOutcome = 'injected' | 'already-injected' | 'failed';

interface InjectEntry {
  file: string;
  map: string;
  debugId?: string;
  outcome: InjectOutcome;
  error?: string;
}

function parseMap(text: string): SourceMapJson {
  const value = JSON.parse(text) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('it is not a JSON object');
  }
  return value as SourceMapJson;
}

function reasonOf(error: unknown): string {
  return error instanceof SyntaxError
    ? 'it is not valid JSON'
    : error instanceof Error
      ? error.message
      : String(error);
}

async function injectFile(file: BuiltFile, dryRun: boolean): Promise<InjectEntry> {
  const entry = { file: file.shown, map: file.mapShown };
  const code = await readFile(file.path, 'utf8');
  const existing = injectedDebugIdOf(code);
  if (existing !== undefined) return { ...entry, debugId: existing, outcome: 'already-injected' };
  const mapText = await readFile(file.mapPath, 'utf8');
  const debugId = debugIdOf(code, mapText);
  let injected;
  try {
    injected = inject(code, parseMap(mapText), debugId);
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

export async function injectSourceMapsCommand(
  { values, positionals }: ParsedCommandLine,
  { io, logger, output }: CommandContext,
): Promise<number> {
  const dryRun = values.get('dry-run') === true;
  const files = await builtFilesUnder(positionals, io.cwd, 'sourcemaps inject');
  const entries: InjectEntry[] = [];
  for (const file of files) {
    const entry = await injectFile(file, dryRun);
    entries.push(entry);
    if (entry.outcome === 'failed') logger.error(entry.error ?? '');
    if (entry.outcome === 'injected') {
      logger.info(
        `${dryRun ? 'Would inject' : 'Injected'} debug ID ${entry.debugId ?? ''} into ${entry.file} and ${entry.map}`,
      );
    }
  }
  const count = (outcome: InjectOutcome) =>
    entries.filter((entry) => entry.outcome === outcome).length;
  const injected = count('injected');
  const already = count('already-injected');
  const failed = count('failed');
  const parts = [
    dryRun
      ? `Dry run: ${plural(injected, 'file')} would be injected`
      : `Injected ${plural(injected, 'file')}`,
    ...(already === 0 ? [] : [`${already} already had a debug ID`]),
    ...(failed === 0 ? [] : [`${failed} failed`]),
    ...(dryRun ? ['nothing was written'] : []),
  ];
  logger.info(parts.join('; '));
  if (values.get('json') === true) {
    output.json({
      status: failed > 0 ? 'failed' : dryRun ? 'dry-run' : 'injected',
      files: entries,
    });
  }
  return failed > 0 ? EXIT_REPORTING_FAILED : EXIT_OK;
}

interface UploadEntry {
  file: string;
  map: string;
  debugId: string;
  url: string;
  bytes: Uint8Array;
}

/** The maps of `files` that carry a debug ID; the others are reported and left out. */
async function mapsToUpload(
  files: readonly BuiltFile[],
  prefix: string,
  context: CommandContext,
): Promise<{ maps: UploadEntry[]; unreadable: { file: string; map: string; error: string }[] }> {
  const maps: UploadEntry[] = [];
  const unreadable: { file: string; map: string; error: string }[] = [];
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
      context.logger.warn(
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

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function uploadSourceMapsCommand(
  { values, positionals }: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const { io, logger, output } = context;
  const help = 'probara sourcemaps upload';
  const release = stringOf(values, 'release')?.trim() ?? '';
  if (release === '') {
    throw new UsageError('--release is required: the release the SDK sends with its events', help);
  }
  const dryRun = values.get('dry-run') === true;
  const json = values.get('json') === true;
  const options = { ...toCoreOptions('sourcemaps upload', values, io.cwd), clientName };
  const setup = resolveSetup(options, io.env, { requireCredentials: !dryRun, now: io.now });
  logger.debugEnabled = setup.kind === 'ready' ? setup.config.debug : values.get('debug') === true;
  for (const warning of setup.warnings) logger.debug(warning);
  if (setup.kind === 'invalid') {
    for (const problem of setup.problems) logger.error(problem);
    return EXIT_USAGE;
  }

  const files = await builtFilesUnder(positionals, io.cwd, 'sourcemaps upload');
  const prefix = stringOf(values, 'url-prefix') ?? DEFAULT_URL_PREFIX;
  const { maps, unreadable } = await mapsToUpload(files, prefix, context);
  for (const { error } of unreadable) logger.error(error);
  if (maps.length === 0 && unreadable.length === 0) {
    throw new UsageError(
      `${positionals.join(', ')} ${positionals.length === 1 ? 'holds' : 'hold'} no source map with a debug ID: run probara sourcemaps inject first`,
      help,
    );
  }
  const describe = ({ file, map, debugId, url }: UploadEntry) => ({ file, map, debugId, url });

  if (dryRun) {
    if (json)
      output.json({ status: 'dry-run', release, uploaded: maps.map(describe), failed: unreadable });
    else for (const map of maps) output.line(`${map.debugId} ${map.url} ${map.map}`);
    logger.info(
      `Dry run: ${plural(maps.length, 'source map')} would be uploaded for release ${release}; nothing was sent`,
    );
    return unreadable.length > 0 ? EXIT_REPORTING_FAILED : EXIT_OK;
  }
  if (setup.kind === 'disabled') {
    logger.info(`${setup.reason}: no source map was uploaded`);
    if (json) output.json({ status: 'disabled' });
    return EXIT_OK;
  }

  const { config } = setup;
  const target: UploadTarget = {
    baseUrl: config.baseUrl,
    apiToken: config.apiToken,
    projectCode: config.projectId,
    release,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    userAgent: `${clientName} node/${process.versions.node}`,
    fetch: io.fetch ?? globalThis.fetch,
    sleep: io.sleep ?? defaultSleep,
    now: () => io.now?.().getTime() ?? Date.now(),
    warn: (message) => {
      logger.warn(message);
    },
  };
  const uploaded: UploadEntry[] = [];
  const failed: (ReturnType<typeof describe> & { error: string })[] = [];
  await eachAtMost(maps, UPLOAD_CONCURRENCY, async (map) => {
    const outcome = await uploadSourceMap(target, map.debugId, map.url, map.bytes);
    if (outcome.ok) {
      uploaded.push(map);
      logger.info(`Uploaded ${map.map} as ${map.url} (${map.debugId})`);
    } else {
      failed.push({ ...describe(map), error: outcome.error });
      logger.error(`Could not upload ${map.map}: ${outcome.error}`);
    }
  });
  const order = (entry: { file: string }) => files.findIndex((file) => file.shown === entry.file);
  uploaded.sort((a, b) => order(a) - order(b));
  failed.sort((a, b) => order(a) - order(b));
  const total = maps.length + unreadable.length;
  const failures = failed.length + unreadable.length;
  logger.info(
    failures === 0
      ? `Uploaded ${plural(uploaded.length, 'source map')} for release ${release}`
      : `Uploaded ${uploaded.length} of ${plural(total, 'source map')} for release ${release}; ${failures} failed`,
  );
  if (json) {
    output.json({
      status: failures === 0 ? 'uploaded' : 'failed',
      release,
      uploaded: uploaded.map(describe),
      failed: [...failed, ...unreadable],
    });
  }
  return failures === 0 ? EXIT_OK : EXIT_REPORTING_FAILED;
}
