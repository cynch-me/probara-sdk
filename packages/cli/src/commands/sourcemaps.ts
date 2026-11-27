/**
 * `probara sourcemaps inject` gives the built JavaScript files and their source maps a debug ID;
 * `probara sourcemaps upload` sends the maps with one to Probara for a release, so the error
 * monitoring SDKs' events of those files are symbolicated by the debug IDs they carry.
 */
import { resolveSetup } from '../configuration.js';
import { EXIT_OK, EXIT_REPORTING_FAILED, EXIT_USAGE } from '../exit-codes.js';
import { stringOf, toCoreOptions, UsageError, type ParsedCommandLine } from '../options.js';
import { builtFilesUnder } from '../sourcemaps/files.js';
import {
  describeUpload,
  injectBuiltFile,
  mapsToUpload,
  uploadMaps,
  type InjectEntry,
  type InjectOutcome,
} from '../sourcemaps/pipeline.js';
import type { UploadTarget } from '../sourcemaps/upload.js';
import type { CommandContext } from './context.js';
import { plural } from './reporting.js';

const DEFAULT_URL_PREFIX = '~/';

export async function injectSourceMapsCommand(
  { values, positionals }: ParsedCommandLine,
  { io, logger, output }: CommandContext,
): Promise<number> {
  const dryRun = values.get('dry-run') === true;
  const files = await builtFilesUnder(positionals, io.cwd, 'sourcemaps inject');
  const entries: InjectEntry[] = [];
  for (const file of files) {
    const entry = await injectBuiltFile(file, { dryRun });
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
  const { maps, unreadable } = await mapsToUpload(files, prefix, (message) => {
    logger.warn(message);
  });
  for (const { error } of unreadable) logger.error(error);
  if (maps.length === 0 && unreadable.length === 0) {
    throw new UsageError(
      `${positionals.join(', ')} ${positionals.length === 1 ? 'holds' : 'hold'} no source map with a debug ID: run probara sourcemaps inject first`,
      help,
    );
  }
  const describe = describeUpload;

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
  const { uploaded, failed } = await uploadMaps(files, maps, target, {
    uploaded: (map) => {
      logger.info(`Uploaded ${map.map} as ${map.url} (${map.debugId})`);
    },
    failed: (map, error) => {
      logger.error(`Could not upload ${map.map}: ${error}`);
    },
  });
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
