import { rm } from 'node:fs/promises';
import { resolveConfig } from '@probara/core';
import { glob } from 'tinyglobby';
import { builtFileAt, type BuiltFile } from '../../cli/src/sourcemaps/built-file.js';
import { injectBuiltFile, mapsToUpload, uploadMaps } from '../../cli/src/sourcemaps/pipeline.js';
import type { UploadTarget } from '../../cli/src/sourcemaps/upload.js';

export interface ProbaraBundlerPluginOptions {
  apiToken?: string | undefined;
  project?: string | undefined;
  baseUrl?: string | undefined;
  release?:
    | {
        name?: string | undefined;
        inject?: boolean | undefined;
      }
    | undefined;
  sourcemaps?:
    | {
        disable?: boolean | undefined;
        urlPrefix?: string | undefined;
        filesToDeleteAfterUpload?: string | readonly string[] | undefined;
      }
    | undefined;
  disable?: boolean | undefined;
  debug?: boolean | undefined;
  silent?: boolean | undefined;
  errorHandler?: ((error: Error) => void) | undefined;
}

export interface BuildOutput {
  dir: string;
  files: readonly string[];
  deleteMaps?: boolean;
}

export type BuildHandler = (output: BuildOutput) => Promise<void>;

const DEFAULT_URL_PREFIX = '~/';

const blankToUndefined = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === '' ? undefined : value.trim();

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function loggerOf(name: string, options: ProbaraBundlerPluginOptions) {
  const prefix = (message: string) => `[${name}] ${message}`;
  return {
    info: (message: string) => {
      if (options.silent !== true) console.info(prefix(message));
    },
    warn: (message: string) => {
      if (options.silent !== true) console.warn(prefix(message));
    },
    debug: (message: string) => {
      if (options.debug === true && options.silent !== true) console.debug(prefix(message));
    },
    prefix,
  };
}

type Logger = ReturnType<typeof loggerOf>;

async function upload(
  files: readonly BuiltFile[],
  release: string | undefined,
  options: ProbaraBundlerPluginOptions,
  name: string,
  logger: Logger,
): Promise<string[]> {
  const env = process.env;
  const apiToken = blankToUndefined(options.apiToken) ?? blankToUndefined(env.PROBARA_API_TOKEN);
  const project = blankToUndefined(options.project) ?? blankToUndefined(env.PROBARA_PROJECT);
  const resolution = resolveConfig(
    {
      apiToken: apiToken ?? 'unset',
      projectId: project ?? 'UNSET',
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.debug === undefined ? {} : { debug: options.debug }),
    },
    env,
  );
  if (!resolution.ok && resolution.disabled && resolution.cause === 'disabled') {
    logger.info(`${resolution.reason}: no source map was uploaded`);
    return [];
  }
  const missing = (what: string) => {
    logger.warn(`${what} to upload the source maps; none was uploaded`);
    return [];
  };
  if (apiToken === undefined) {
    return missing('No API token: set PROBARA_API_TOKEN (or the apiToken option)');
  }
  if (project === undefined)
    return missing('No project: set PROBARA_PROJECT (or the project option)');
  if (release === undefined) {
    return missing('No release: set PROBARA_RELEASE (or the release.name option)');
  }
  if (!resolution.ok) return resolution.disabled ? [resolution.reason] : resolution.problems;
  const { config } = resolution;
  const target: UploadTarget = {
    baseUrl: config.baseUrl,
    apiToken: config.apiToken,
    projectCode: config.projectId,
    release,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    userAgent: `${name} node/${process.versions.node}`,
    fetch: globalThis.fetch,
    sleep,
    now: () => Date.now(),
    warn: logger.warn,
  };
  const prefix = options.sourcemaps?.urlPrefix ?? DEFAULT_URL_PREFIX;
  const { maps, unreadable } = await mapsToUpload(files, prefix, logger.warn);
  const { uploaded, failed } = await uploadMaps(files, maps, target, {
    uploaded: (map) => {
      logger.debug(`Uploaded ${map.map} as ${map.url} (${map.debugId})`);
    },
    failed: () => undefined,
  });
  if (uploaded.length > 0) {
    logger.info(`Uploaded ${plural(uploaded.length, 'source map')} for release ${release}`);
  }
  return [
    ...unreadable.map(({ error }) => error),
    ...failed.map(({ map, error }) => `Could not upload ${map}: ${error}`),
  ];
}

async function deleteAfterUpload(
  files: readonly BuiltFile[],
  output: BuildOutput,
  options: ProbaraBundlerPluginOptions,
  logger: Logger,
): Promise<void> {
  const patterns = options.sourcemaps?.filesToDeleteAfterUpload;
  const matched =
    patterns === undefined
      ? []
      : await glob(typeof patterns === 'string' ? [patterns] : [...patterns], {
          cwd: process.cwd(),
          absolute: true,
          dot: true,
        });
  const paths = [
    ...matched,
    ...(output.deleteMaps === true ? files.map((file) => file.mapPath) : []),
  ];
  for (const path of new Set(paths)) {
    await rm(path, { force: true });
    logger.debug(`Deleted ${path}`);
  }
}

export function createBuildHandler(
  options: ProbaraBundlerPluginOptions,
  { name }: { name: string },
): BuildHandler {
  const logger = loggerOf(name, options);
  return async (output) => {
    if (options.disable === true) return;
    const cwd = process.cwd();
    const release =
      blankToUndefined(options.release?.name) ?? blankToUndefined(process.env.PROBARA_RELEASE);
    const files: BuiltFile[] = [];
    for (const path of output.files) {
      const file = await builtFileAt(path, output.dir, cwd);
      if (file !== undefined) files.push(file);
    }
    if (files.length === 0) {
      logger.debug('No emitted JavaScript file has a source map: nothing to inject or upload');
      return;
    }
    const problems: string[] = [];
    let injected = 0;
    for (const file of files) {
      const entry = await injectBuiltFile(file, {
        dryRun: false,
        release: options.release?.inject === false ? undefined : release,
      });
      if (entry.outcome === 'failed') problems.push(entry.error ?? '');
      if (entry.outcome === 'injected') injected += 1;
    }
    if (injected > 0) logger.info(`Injected a debug ID into ${plural(injected, 'file')}`);
    if (options.sourcemaps?.disable !== true) {
      problems.push(...(await upload(files, release, options, name, logger)));
      await deleteAfterUpload(files, output, options, logger);
    }
    if (problems.length === 0) return;
    const error = new Error(problems.map(logger.prefix).join('\n'));
    if (options.errorHandler === undefined) throw error;
    options.errorHandler(error);
  };
}
