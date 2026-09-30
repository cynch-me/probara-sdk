/**
 * What the reporter, `createRun` and `closeRun` share: seams, a safe logger, the client of a config
 * and the fields of a new run.
 */
import { createClient, type ClientOptions, type ProbaraClient } from './client.js';
import type { ConfigResolution, ResolvedConfig, ResolvedRun } from './config.js';
import { createConsoleLogger, redact, type Logger } from './logger.js';
import type { RunSource } from './source.js';

/** Seams of {@link createReporter}, {@link createRun} and {@link closeRun}, for adapters and tests. */
export interface RuntimeOptions {
  /** Where core writes. Defaults to the console (`[probara] ` prefix). */
  logger?: Logger | undefined;
  /** The environment `PROBARA_*` and CI variables are read from. Defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>> | undefined;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch | undefined;
  /** Waits between retries; see {@link ClientOptions.sleep}. Defaults to `setTimeout`. */
  sleep?: ClientOptions['sleep'] | undefined;
  /** Source of the backoff jitter, in `[0, 1)`. Defaults to `Math.random`. */
  random?: (() => number) | undefined;
  /** Clock of the default run name and of `Retry-After` dates. Defaults to the current time. */
  now?: (() => Date) | undefined;
}

type Env = NonNullable<RuntimeOptions['env']>;

const TRUE_VALUES = /^(?:true|1|yes|on)$/i;

/** The problem of options an untyped caller passed that are not an object (`null`, a number...). */
export const OPTIONS_NOT_AN_OBJECT = 'options must be an object';

/** Whether `options` can be read at all: a default parameter only covers `undefined`. */
export function isOptionsObject(options: unknown): options is object {
  return typeof options === 'object' && options !== null;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The token candidates to redact before the configuration is known to be valid. */
export function secretsOf(options: { apiToken?: unknown }, env: Env): string[] {
  const candidates: unknown[] = [options.apiToken, env.PROBARA_API_TOKEN];
  return candidates
    .map((secret) => (typeof secret === 'string' ? secret.trim() : ''))
    .filter((secret) => secret !== '');
}

/** A logger that redacts every message and swallows its own failures. */
export function safeLogger(inner: Logger, secrets: readonly string[]): Logger {
  const write = (level: keyof Logger) => (message: string) => {
    try {
      inner[level](redact(message, secrets));
    } catch {
      // A broken logger must not break the test run.
    }
  };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}

/** The safe logger of a resolution: the given logger, else the console at the resolved debug level. */
export function loggerOf(
  resolution: ConfigResolution,
  options: RuntimeOptions & { apiToken?: unknown; debug?: unknown },
  env: Env,
): Logger {
  const secrets = resolution.ok ? [resolution.config.apiToken] : secretsOf(options, env);
  const debug = resolution.ok
    ? resolution.config.debug
    : typeof options.debug === 'boolean'
      ? options.debug
      : TRUE_VALUES.test(env.PROBARA_DEBUG?.trim() ?? '');
  return safeLogger(options.logger ?? createConsoleLogger({ debug }), secrets);
}

/** The client of a resolved configuration, with the seams of `options`. Throws a TypeError. */
export function clientOf(
  config: ResolvedConfig,
  options: RuntimeOptions,
  logger: Logger,
): ProbaraClient {
  const { now } = options;
  return createClient({
    baseUrl: config.baseUrl,
    apiToken: config.apiToken,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    logger,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    ...(options.random === undefined ? {} : { random: options.random }),
    ...(now === undefined ? {} : { now: () => now().getTime() }),
    ...(config.clientName === undefined ? {} : { clientName: config.clientName }),
  });
}

/** The page of a run in Probara, in the configured project unless `projectId` names another. */
export function runUrlOf(
  config: ResolvedConfig,
  displayId: string,
  projectId: string = config.projectId,
): string {
  return `${config.baseUrl}/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(displayId)}`;
}

/** The fields of a new run in a request body, only those set: the same in a report and a creation. */
export interface NewRunFields {
  name: string;
  environmentId?: string;
  milestoneId?: string;
  configurationUlids?: string[];
  tags?: string[];
}

/** The body fields of the new run a resolved config describes. */
export function newRunFieldsOf(run: Exclude<ResolvedRun, { ulid: string }>): NewRunFields {
  const { name, environmentId, milestoneId, configurationUlids, tags } = run;
  return {
    name,
    ...(environmentId === undefined ? {} : { environmentId }),
    ...(milestoneId === undefined ? {} : { milestoneId }),
    ...(configurationUlids.length === 0 ? {} : { configurationUlids: [...configurationUlids] }),
    ...(tags.length === 0 ? {} : { tags: [...tags] }),
  };
}

/** `{ source }` of a run body, or nothing when the resolved source is empty. */
export function sourceFieldOf(source: Readonly<RunSource>): { source?: RunSource } {
  return Object.keys(source).length === 0 ? {} : { source: { ...source } };
}
