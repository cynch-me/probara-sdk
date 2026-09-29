import { resolve } from 'node:path';
import { detectCiSource, envReader, type CiInfo } from './ci.js';
import { MAX_RETRIES, MAX_TIMEOUT_MS } from './client.js';
import {
  MAX_CONFIGURATION_ULIDS,
  MAX_RESULTS_PER_REPORT,
  MAX_RUN_NAME_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  ULID_PATTERN,
} from './limits.js';
import { sanitizeRunSource, type RunSource } from './source.js';
import { toSingleLine, truncate } from './text.js';

/** The run a report goes into: reuse one (`ulid`) or describe the one to create. */
export interface ProbaraRunOptions {
  ulid?: string | undefined;
  name?: string | undefined;
  environmentId?: string | undefined;
  milestoneId?: string | undefined;
  configurationUlids?: readonly string[] | undefined;
  tags?: readonly string[] | undefined;
}

/**
 * Options of a reporter. Each one falls back to its `PROBARA_*` variable, then to its default;
 * an `undefined` option never overwrites the environment.
 */
export interface ProbaraOptions {
  /** `PROBARA_ENABLED`. `false` turns reporting off. */
  enabled?: boolean | undefined;
  /** `PROBARA_API_TOKEN`. */
  apiToken?: string | undefined;
  /** `PROBARA_PROJECT`: the project code, such as `SHOP`. */
  projectId?: string | undefined;
  /** `PROBARA_BASE_URL`. Defaults to `https://app.probara.net`. */
  baseUrl?: string | undefined;
  /** `PROBARA_RUN_*`, `PROBARA_ENVIRONMENT_ID`, `PROBARA_MILESTONE_ID`, `PROBARA_CONFIGURATION_ULIDS`. */
  run?: ProbaraRunOptions | undefined;
  /** Overrides the detected CI source field by field (a blank field counts as unset); `false` sends no source. */
  source?: RunSource | false | undefined;
  /** `PROBARA_CREATE_MISSING_CASES`. Defaults to `true`. */
  createMissingCases?: boolean | undefined;
  /** `PROBARA_SUITE_ULID`: the suite created cases go under. */
  suiteUlid?: string | undefined;
  /** `PROBARA_CLOSE_RUN`. Defaults to `true` for a new run, `false` for a reused one. */
  closeRun?: boolean | undefined;
  /** Directory test file paths are relative to. Defaults to `process.cwd()`. */
  rootDir?: string | undefined;
  /** `PROBARA_DEBUG`. */
  debug?: boolean | undefined;
  /** The adapter, such as `probara-playwright/0.1.0`, sent in the User-Agent. */
  clientName?: string | undefined;
  /** Results per report, 1..500. Defaults to 500. */
  chunkSize?: number | undefined;
  /** Timeout of one HTTP attempt, 1..600000. Defaults to 30000. */
  timeoutMs?: number | undefined;
  /** Retries of a failed report, 0..10. Defaults to 4. */
  maxRetries?: number | undefined;
}

export type ResolvedRun =
  | { readonly ulid: string }
  | {
      readonly name: string;
      readonly environmentId?: string;
      readonly milestoneId?: string;
      readonly configurationUlids: readonly string[];
      readonly tags: readonly string[];
    };

export interface ResolvedConfig {
  readonly apiToken: string;
  readonly projectId: string;
  readonly baseUrl: string;
  readonly run: ResolvedRun;
  readonly source: Readonly<RunSource>;
  readonly createMissingCases: boolean;
  readonly suiteUlid?: string;
  readonly closeRun: boolean;
  readonly rootDir: string;
  readonly debug: boolean;
  readonly clientName?: string;
  readonly chunkSize: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

export type ConfigResolution =
  | { ok: true; config: ResolvedConfig; warnings: string[] }
  | { ok: false; disabled: true; reason: string; warnings: string[] }
  | { ok: false; disabled: false; problems: string[]; warnings: string[] };

export interface ResolveConfigContext {
  /** The clock of the default run name. Defaults to the current time. */
  now?: () => Date;
}

type Env = Readonly<Record<string, string | undefined>>;

const DEFAULT_BASE_URL = 'https://app.probara.net';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 4;
const TRUE_VALUES: ReadonlySet<string> = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES: ReadonlySet<string> = new Set(['false', '0', 'no', 'off']);
const NEW_RUN_FIELDS = [
  ['name', 'PROBARA_RUN_NAME'],
  ['environmentId', 'PROBARA_ENVIRONMENT_ID'],
  ['milestoneId', 'PROBARA_MILESTONE_ID'],
  ['configurationUlids', 'PROBARA_CONFIGURATION_ULIDS'],
  ['tags', 'PROBARA_RUN_TAGS'],
] as const;

/** A setting and where it came from, the name messages use. Values are never echoed. */
interface Setting<T> {
  value: T;
  label: string;
}

function listOf(text: string): string[] {
  return text.split(',');
}

function joinNames(names: readonly string[]): string {
  return names.length === 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

function defaultRunName(now: Date): string {
  const iso = now.toISOString();
  return `Automated run ${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function isHttpBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

function freeze<T extends object>(value: T): Readonly<T> {
  for (const nested of Object.values(value)) {
    if (typeof nested === 'object' && nested !== null) freeze(nested as object);
  }
  return Object.freeze(value);
}

/** Collects settings from options and the environment, and the problems and warnings they raise. */
class Settings {
  readonly problems: string[] = [];
  readonly warnings: string[] = [];
  /** Labels of options rejected for their type: a problem was already reported for them. */
  readonly invalid = new Set<string>();
  /** The trimmed value of a variable, `undefined` when unset or blank. */
  readonly read: (variable: string) => string | undefined;

  constructor(env: Env) {
    this.read = envReader(env);
  }

  /** A trimmed string option, else its variable; blank values count as unset. */
  string(option: unknown, label: string, variable: string): Setting<string> | undefined {
    if (option !== undefined && typeof option !== 'string') {
      this.problems.push(`${label} must be a string`);
      this.invalid.add(label);
      return undefined;
    }
    const trimmed = option?.trim();
    if (trimmed !== undefined && trimmed !== '') return { value: trimmed, label };
    const fromEnv = this.read(variable);
    return fromEnv === undefined ? undefined : { value: fromEnv, label: variable };
  }

  /** A list option, else its comma-separated variable. */
  list(
    option: readonly string[] | undefined,
    label: string,
    variable: string,
  ): Setting<readonly string[]> | undefined {
    if (option !== undefined) return { value: option, label };
    const fromEnv = this.read(variable);
    return fromEnv === undefined ? undefined : { value: listOf(fromEnv), label: variable };
  }

  /** A boolean option (checked at runtime: adapters may pass anything), else its variable. */
  boolean(option: unknown, label: string, variable: string): Setting<boolean> | undefined {
    if (typeof option === 'boolean') return { value: option, label };
    if (option !== undefined) {
      this.problems.push(`${label} must be true or false`);
      return undefined;
    }
    const fromEnv = this.read(variable)?.toLowerCase();
    if (fromEnv === undefined) return undefined;
    if (TRUE_VALUES.has(fromEnv)) return { value: true, label: variable };
    if (FALSE_VALUES.has(fromEnv)) return { value: false, label: variable };
    this.problems.push(`${variable} must be true or false`);
    return undefined;
  }

  ulid(setting: Setting<string> | undefined): string | undefined {
    if (setting === undefined) return undefined;
    const ulid = setting.value.trim().toUpperCase();
    if (ULID_PATTERN.test(ulid)) return ulid;
    this.problems.push(`${setting.label} is not a ULID`);
    return undefined;
  }

  number(
    option: number | undefined,
    label: string,
    fallback: number,
    isValid: (value: number) => boolean,
    rule: string,
  ): number {
    if (option === undefined) return fallback;
    if (isValid(option)) return option;
    this.problems.push(`${label} must be ${rule}`);
    return fallback;
  }
}

function resolveNewRun(
  settings: Settings,
  run: ProbaraRunOptions,
  defaultName: () => string,
): ResolvedRun {
  const nameSetting = settings.string(run.name, 'run.name', 'PROBARA_RUN_NAME');
  let name = toSingleLine(nameSetting?.value ?? '');
  if (name.length > MAX_RUN_NAME_LENGTH) {
    settings.warnings.push(`Truncated the run name to ${MAX_RUN_NAME_LENGTH} characters`);
  }
  name = truncate(name === '' ? toSingleLine(defaultName()) : name, MAX_RUN_NAME_LENGTH);

  const environmentId = settings.ulid(
    settings.string(run.environmentId, 'run.environmentId', 'PROBARA_ENVIRONMENT_ID'),
  );
  const milestoneId = settings.ulid(
    settings.string(run.milestoneId, 'run.milestoneId', 'PROBARA_MILESTONE_ID'),
  );

  const configurations = settings.list(
    run.configurationUlids,
    'run.configurationUlids',
    'PROBARA_CONFIGURATION_ULIDS',
  );
  const configurationUlids = [
    ...new Set(
      (configurations?.value ?? [])
        .map((ulid) => ulid.trim().toUpperCase())
        .filter((ulid) => ulid !== ''),
    ),
  ];
  if (configurations !== undefined) {
    if (configurationUlids.some((ulid) => !ULID_PATTERN.test(ulid))) {
      settings.problems.push(`${configurations.label} holds a value that is not a ULID`);
    } else if (configurationUlids.length > MAX_CONFIGURATION_ULIDS) {
      settings.problems.push(
        `${configurations.label} holds more than ${MAX_CONFIGURATION_ULIDS} ULIDs`,
      );
    }
  }

  const tagSetting = settings.list(run.tags, 'run.tags', 'PROBARA_RUN_TAGS');
  const tags = [
    ...new Set(
      (tagSetting?.value ?? [])
        .map((tag) => truncate(toSingleLine(tag), MAX_TAG_LENGTH))
        .filter((tag) => tag !== ''),
    ),
  ];
  if (tags.length > MAX_TAGS) {
    settings.warnings.push(
      `Dropped ${tags.length - MAX_TAGS} run tags beyond the limit of ${MAX_TAGS}`,
    );
    tags.length = MAX_TAGS;
  }

  return {
    name,
    ...(environmentId === undefined ? {} : { environmentId }),
    ...(milestoneId === undefined ? {} : { milestoneId }),
    configurationUlids,
    tags,
  };
}

function resolveSource(
  settings: Settings,
  option: ProbaraOptions['source'],
  detected: CiInfo,
): RunSource {
  if (option === false) return {};
  const merged: RunSource = {};
  for (const field of ['branch', 'commit', 'buildUrl'] as const) {
    const explicit = option?.[field];
    // Like every other option, a blank explicit field counts as unset.
    const value = typeof explicit === 'string' && explicit.trim() === '' ? undefined : explicit;
    const chosen = value ?? detected[field];
    if (chosen !== undefined) merged[field] = chosen;
  }
  return sanitizeRunSource(merged, (message) => settings.warnings.push(message));
}

/**
 * Resolves a reporter's settings: explicit options, then `PROBARA_*` variables, then defaults.
 *
 * Without a token and a project, reporting is `disabled` (a local run stays quiet); with only one
 * of them, or with an invalid value, the resolution lists `problems`. Messages name the option or
 * variable at fault and never echo a value, so the token cannot leak through them.
 */

export function resolveConfig(
  options: ProbaraOptions = {},
  env: Env = process.env,
  context: ResolveConfigContext = {},
): ConfigResolution {
  const settings = new Settings(env);
  const { problems, warnings } = settings;

  const enabled = settings.boolean(options.enabled, 'the enabled option', 'PROBARA_ENABLED');
  if (enabled?.value === false) {
    return {
      ok: false,
      disabled: true,
      reason: `Probara reporting is disabled by ${enabled.label}`,
      warnings,
    };
  }

  const apiToken = settings.string(options.apiToken, 'apiToken', 'PROBARA_API_TOKEN');
  const projectId = settings.string(options.projectId, 'projectId', 'PROBARA_PROJECT');
  if (apiToken === undefined && projectId === undefined && problems.length === 0) {
    return {
      ok: false,
      disabled: true,
      reason:
        'Probara reporting is not configured: set PROBARA_API_TOKEN and PROBARA_PROJECT to enable it',
      warnings,
    };
  }
  if (apiToken === undefined && !settings.invalid.has('apiToken')) {
    problems.push('The API token is not set: pass apiToken or set PROBARA_API_TOKEN');
  }
  if (projectId === undefined && !settings.invalid.has('projectId')) {
    problems.push('The project is not set: pass projectId or set PROBARA_PROJECT');
  }

  const baseUrlSetting = settings.string(options.baseUrl, 'baseUrl', 'PROBARA_BASE_URL');
  let baseUrl = DEFAULT_BASE_URL;
  if (baseUrlSetting !== undefined) {
    if (isHttpBaseUrl(baseUrlSetting.value)) baseUrl = baseUrlSetting.value.replace(/\/+$/, '');
    else
      problems.push(`${baseUrlSetting.label} must be an http(s) URL without a query or fragment`);
  }

  const runOptions = options.run ?? {};
  const ulidSetting = settings.string(runOptions.ulid, 'run.ulid', 'PROBARA_RUN_ULID');
  const ci = detectCiSource(env);
  const defaultName = () =>
    ci.buildName ?? defaultRunName(context.now === undefined ? new Date() : context.now());
  let run: ResolvedRun;
  if (ulidSetting === undefined) {
    run = resolveNewRun(settings, runOptions, defaultName);
  } else {
    run = { ulid: settings.ulid(ulidSetting) ?? '' };
    const ignored = NEW_RUN_FIELDS.filter(
      ([field, variable]) =>
        runOptions[field] !== undefined || settings.read(variable) !== undefined,
    ).map(([field]) => field);
    if (ignored.length > 0) {
      warnings.push(`Ignored ${joinNames(ignored)}: a reused run (run.ulid) keeps its own`);
    }
  }

  const source = resolveSource(settings, options.source, ci);
  const createMissingCases =
    settings.boolean(
      options.createMissingCases,
      'createMissingCases',
      'PROBARA_CREATE_MISSING_CASES',
    )?.value ?? true;
  const suiteUlid = settings.ulid(
    settings.string(options.suiteUlid, 'suiteUlid', 'PROBARA_SUITE_ULID'),
  );
  const closeRun =
    settings.boolean(options.closeRun, 'closeRun', 'PROBARA_CLOSE_RUN')?.value ??
    ulidSetting === undefined;
  const debug = settings.boolean(options.debug, 'debug', 'PROBARA_DEBUG')?.value ?? false;

  const chunkSize = settings.number(
    options.chunkSize,
    'chunkSize',
    MAX_RESULTS_PER_REPORT,
    (value) => Number.isInteger(value) && value >= 1 && value <= MAX_RESULTS_PER_REPORT,
    `an integer from 1 to ${MAX_RESULTS_PER_REPORT}`,
  );
  const timeoutMs = settings.number(
    options.timeoutMs,
    'timeoutMs',
    DEFAULT_TIMEOUT_MS,
    (value) => Number.isInteger(value) && value >= 1 && value <= MAX_TIMEOUT_MS,
    `an integer from 1 to ${MAX_TIMEOUT_MS}`,
  );
  const maxRetries = settings.number(
    options.maxRetries,
    'maxRetries',
    DEFAULT_MAX_RETRIES,
    (value) => Number.isInteger(value) && value >= 0 && value <= MAX_RETRIES,
    `an integer from 0 to ${MAX_RETRIES}`,
  );

  if (problems.length > 0 || apiToken === undefined || projectId === undefined) {
    return { ok: false, disabled: false, problems, warnings };
  }

  const clientName = options.clientName === undefined ? '' : toSingleLine(options.clientName);
  const config: ResolvedConfig = {
    apiToken: apiToken.value,
    projectId: projectId.value,
    baseUrl,
    run,
    source,
    createMissingCases,
    ...(suiteUlid === undefined ? {} : { suiteUlid }),
    closeRun,
    rootDir: resolve(options.rootDir ?? process.cwd()),
    debug,
    ...(clientName === '' ? {} : { clientName }),
    chunkSize,
    timeoutMs,
    maxRetries,
  };
  return { ok: true, config: freeze(config), warnings };
}
