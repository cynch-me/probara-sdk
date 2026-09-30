import { resolve } from 'node:path';
import type { ResultStatus } from './api.js';
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
import { isResultStatus, RESULT_STATUSES } from './result.js';
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
  /**
   * `PROBARA_RUN_ULIDS` (`WEB=01J…,API=01J…`): the run to reuse in each project, by project code,
   * such as the runs `probara run create --project WEB` created for the shards of a CI job. The
   * run of the configured project counts as `ulid`; a project without one gets a new run.
   */
  ulids?: Readonly<Record<string, string>> | undefined;
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
  /** `PROBARA_UPLOAD_ATTACHMENTS`. `false` sends no result attachment. Defaults to `true`. */
  uploadAttachments?: boolean | undefined;
  /** Results whose attachments upload at the same time, 1..8. Defaults to 2. */
  attachmentConcurrency?: number | undefined;
  /**
   * `PROBARA_STATUS_MAPPING` (`failed=blocked,skipped=passed`): the status each result is sent
   * with instead of its own. Applied before `statusFilter`.
   */
  statusMapping?: StatusMapping | undefined;
  /**
   * `PROBARA_STATUS_FILTER` (`skipped,blocked`): results with these statuses (after
   * `statusMapping`) are not sent.
   */
  statusFilter?: readonly ResultStatus[] | undefined;
  /**
   * `PROBARA_PROJECTS` (`WEB,API`): the codes of the other projects results may be reported to. A
   * result linked to a case of one of them (`WEB-3`) goes into a run of that project; one linked
   * to a case of a project that is neither `projectId` nor listed here is not sent.
   */
  projects?: readonly string[] | undefined;
}

/** Which status a result is sent with, by its own status. */
export type StatusMapping = Readonly<Partial<Record<ResultStatus, ResultStatus>>>;

export type ResolvedRun =
  | { readonly ulid: string }
  | {
      readonly name: string;
      readonly environmentId?: string;
      readonly milestoneId?: string;
      readonly configurationUlids: readonly string[];
      readonly tags: readonly string[];
    };

/** A project results may be reported to besides the configured one, and its run. */
export interface ResolvedProject {
  readonly projectId: string;
  /**
   * A run to reuse (`run.ulids`), or the new run to create: the name and tags of the configured
   * project's, without its environment, milestone and configurations (they belong to one project).
   */
  readonly run: ResolvedRun;
  /** `closeRun`, else `true` for a new run and `false` for a reused one. */
  readonly closeRun: boolean;
}

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
  readonly uploadAttachments: boolean;
  readonly attachmentConcurrency: number;
  readonly statusMapping: StatusMapping;
  readonly statusFilter: readonly ResultStatus[];
  /** The other projects results may be reported to (`projects`), in order; empty by default. */
  readonly projects: readonly ResolvedProject[];
}

/**
 * Why reporting is disabled: `disabled` when `enabled` or `PROBARA_ENABLED` turned it off,
 * `not_configured` when neither a token nor a project is set.
 */
export type DisabledCause = 'disabled' | 'not_configured';

export type ConfigResolution =
  | { ok: true; config: ResolvedConfig; warnings: string[] }
  | { ok: false; disabled: true; cause: DisabledCause; reason: string; warnings: string[] }
  | { ok: false; disabled: false; problems: string[]; warnings: string[] };

export interface ResolveConfigContext {
  /** The clock of the default run name. Defaults to the current time. */
  now?: () => Date;
}

type Env = Readonly<Record<string, string | undefined>>;

const DEFAULT_BASE_URL = 'https://app.probara.net';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_ATTACHMENT_CONCURRENCY = 2;
/** The most results whose attachments a reporter uploads at the same time. */
const MAX_ATTACHMENT_CONCURRENCY = 8;
const TRUE_VALUES: ReadonlySet<string> = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES: ReadonlySet<string> = new Set(['false', '0', 'no', 'off']);
/** The fields of a new run that belong to one project: never sent to another project's run. */
const PROJECT_RUN_FIELDS = ['environmentId', 'milestoneId', 'configurationUlids'] as const;
/** A project code: a capital letter, then capitals or digits. */
const PROJECT_CODE = /^[A-Z][A-Z0-9]*$/;
const NOT_A_PROJECT_CODE =
  'holds a value that is not a project code (capital letters and digits, such as WEB)';
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

type BooleanSetting = Setting<boolean | undefined> | { problem: string };

function booleanSetting(
  option: unknown,
  label: string,
  variable: string,
  read: (variable: string) => string | undefined,
): BooleanSetting {
  if (typeof option === 'boolean') return { value: option, label };
  if (option !== undefined) return { problem: `${label} must be true or false` };
  const fromEnv = read(variable)?.toLowerCase();
  if (fromEnv === undefined) return { value: undefined, label: variable };
  if (TRUE_VALUES.has(fromEnv)) return { value: true, label: variable };
  if (FALSE_VALUES.has(fromEnv)) return { value: false, label: variable };
  return { problem: `${variable} must be true or false` };
}

/** A boolean setting of an adapter: its value, or the problem that makes it unusable. */
export interface BooleanSettingResolution {
  /** `undefined` when neither the option nor the variable is set: the adapter's default applies. */
  value?: boolean;
  /** Names the option or the variable at fault, never its value. */
  problem?: string;
}

/**
 * Resolves a boolean setting an adapter adds to core's, with core's rules: the option (it must be a
 * boolean), else its variable (`true/1/yes/on`, `false/0/no/off`, in any case, trimmed; blank is
 * unset). A value of the wrong type is a problem: pass it to `createReporter` as
 * `adapterProblems`, so it turns reporting off like a problem of core's own.
 */
export function resolveBooleanSetting(
  option: unknown,
  label: string,
  variable: string,
  env: Env = process.env,
): BooleanSettingResolution {
  const setting = booleanSetting(option, label, variable, envReader(env));
  if ('problem' in setting) return { problem: setting.problem };
  return setting.value === undefined ? {} : { value: setting.value };
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

  /** An option without a variable that must be a string when set (checked at runtime). */
  optionalString(option: unknown, label: string): string | undefined {
    if (option === undefined || typeof option === 'string') return option;
    this.problems.push(`${label} must be a string`);
    return undefined;
  }

  /** A list option (checked at runtime: adapters may pass anything), else its comma-separated variable. */
  list(option: unknown, label: string, variable: string): Setting<readonly string[]> | undefined {
    if (option !== undefined) {
      if (Array.isArray(option) && option.every((item) => typeof item === 'string')) {
        return { value: option, label };
      }
      this.problems.push(`${label} must be a list of strings`);
      return undefined;
    }
    const fromEnv = this.read(variable);
    return fromEnv === undefined ? undefined : { value: listOf(fromEnv), label: variable };
  }

  /** A boolean option (checked at runtime: adapters may pass anything), else its variable. */
  boolean(option: unknown, label: string, variable: string): Setting<boolean> | undefined {
    const setting = booleanSetting(option, label, variable, this.read);
    if ('problem' in setting) {
      this.problems.push(setting.problem);
      return undefined;
    }
    return setting.value === undefined ? undefined : { value: setting.value, label: setting.label };
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
): Exclude<ResolvedRun, { ulid: string }> {
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

/** The other project codes of `projects`: trimmed, non-blank, once each, without `projectId`. */
function resolveProjectCodes(
  settings: Settings,
  option: unknown,
  projectId: string | undefined,
): string[] {
  const setting = settings.list(option, 'projects', 'PROBARA_PROJECTS');
  if (setting === undefined) return [];
  const codes = [
    ...new Set(setting.value.map((code) => code.trim()).filter((code) => code !== '')),
  ];
  if (!codes.every((code) => PROJECT_CODE.test(code))) {
    settings.problems.push(`${setting.label} ${NOT_A_PROJECT_CODE}`);
    return [];
  }
  return codes.filter((code) => code !== projectId);
}

/** The runs of `run.ulids` (else `PROBARA_RUN_ULIDS`) by project code, and where they came from. */
function resolveRunUlids(settings: Settings, option: unknown): Setting<Map<string, string>> {
  const runs = new Map<string, string>();
  let label = 'run.ulids';
  let entries: [string, unknown][];
  if (option !== undefined) {
    if (typeof option !== 'object' || option === null || Array.isArray(option)) {
      settings.problems.push(`${label} must map project codes to run ULIDs`);
      return { value: runs, label };
    }
    entries = Object.entries(option);
  } else {
    label = 'PROBARA_RUN_ULIDS';
    const text = settings.read(label);
    if (text === undefined) return { value: runs, label };
    entries = [];
    for (const entry of listOf(text)) {
      if (entry.trim() === '') continue;
      const [code, ulid, ...rest] = entry.split('=').map((part) => part.trim());
      if (code === undefined || code === '' || ulid === undefined || rest.length > 0) {
        settings.problems.push(`${label} must be a comma-separated list of <project>=<run ULID>`);
        return { value: runs, label };
      }
      if (entries.some(([seen]) => seen === code)) {
        settings.problems.push(`${label} names the run of a project twice`);
        return { value: runs, label };
      }
      entries.push([code, ulid]);
    }
  }
  if (!entries.every(([code]) => PROJECT_CODE.test(code.trim()))) {
    settings.problems.push(`${label} ${NOT_A_PROJECT_CODE}`);
    return { value: runs, label };
  }
  for (const [code, value] of entries) {
    const ulid = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!ULID_PATTERN.test(ulid)) {
      settings.problems.push(`${label} holds a value that is not a ULID`);
      return { value: new Map(), label };
    }
    runs.set(code.trim(), ulid);
  }
  return { value: runs, label };
}

function resolveSource(
  settings: Settings,
  option: ProbaraOptions['source'],
  detected: CiInfo,
): RunSource {
  if (option === false) return {};
  const merged: RunSource = {};
  for (const field of ['branch', 'commit', 'buildUrl'] as const) {
    const explicit: unknown = option?.[field];
    if (explicit !== undefined && typeof explicit !== 'string') {
      // An adapter bug; the run is still reported, without this field (like any invalid one).
      settings.warnings.push(`Ignored source.${field}: it must be a string`);
      continue;
    }
    // Like every other option, a blank explicit field counts as unset.
    const value = typeof explicit === 'string' && explicit.trim() === '' ? undefined : explicit;
    const chosen = value ?? detected[field];
    if (chosen !== undefined) merged[field] = chosen;
  }
  return sanitizeRunSource(merged, (message) => settings.warnings.push(message));
}

/** The status rules of a configuration: `statusMapping`, then `statusFilter`. */
export interface StatusRules {
  readonly statusMapping: StatusMapping;
  readonly statusFilter: readonly ResultStatus[];
}

/**
 * The status a result is sent with (after `statusMapping`), and whether `statusFilter` leaves it
 * out. The reporter applies it to every result; an adapter that prints what is sent can too.
 */
export function applyStatusRules(
  status: ResultStatus,
  rules: StatusRules,
): { status: ResultStatus; filtered: boolean } {
  const mapped = rules.statusMapping[status] ?? status;
  return { status: mapped, filtered: rules.statusFilter.includes(mapped) };
}

const STATUS_NAMES = RESULT_STATUSES.join(', ');

function resolveStatusMapping(settings: Settings, option: unknown): StatusMapping {
  if (option !== undefined) {
    const valid =
      typeof option === 'object' &&
      option !== null &&
      !Array.isArray(option) &&
      Object.entries(option).every(([from, to]) => isResultStatus(from) && isResultStatus(to));
    if (valid) return { ...(option as StatusMapping) };
    settings.problems.push(`statusMapping must map statuses to statuses (${STATUS_NAMES})`);
    return {};
  }
  const variable = 'PROBARA_STATUS_MAPPING';
  const text = settings.read(variable);
  if (text === undefined) return {};
  const mapping: Partial<Record<ResultStatus, ResultStatus>> = {};
  for (const entry of listOf(text)) {
    if (entry.trim() === '') continue;
    const [from, to, ...rest] = entry.split('=').map((part) => part.trim().toLowerCase());
    if (!isResultStatus(from) || !isResultStatus(to) || rest.length > 0) {
      settings.problems.push(
        `${variable} must be a comma-separated list of <status>=<status> (statuses: ${STATUS_NAMES})`,
      );
      return {};
    }
    if (from in mapping) {
      settings.problems.push(`${variable} maps a status twice`);
      return {};
    }
    mapping[from] = to;
  }
  return mapping;
}

function resolveStatusFilter(settings: Settings, option: unknown): ResultStatus[] {
  if (option !== undefined) {
    if (Array.isArray(option) && option.every(isResultStatus)) return [...new Set(option)];
    settings.problems.push(`statusFilter must be a list of statuses (${STATUS_NAMES})`);
    return [];
  }
  const variable = 'PROBARA_STATUS_FILTER';
  const text = settings.read(variable);
  if (text === undefined) return [];
  const statuses = listOf(text)
    .map((status) => status.trim().toLowerCase())
    .filter((status) => status !== '');
  if (!statuses.every(isResultStatus)) {
    settings.problems.push(`${variable} holds a value that is not a status (${STATUS_NAMES})`);
    return [];
  }
  return [...new Set(statuses)];
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
      cause: 'disabled',
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
      cause: 'not_configured',
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
  const extraCodes = resolveProjectCodes(settings, options.projects, projectId?.value);
  const runUlids = resolveRunUlids(settings, runOptions.ulids);
  let mainUlid = ulidSetting === undefined ? undefined : (settings.ulid(ulidSetting) ?? '');
  const listedUlid = projectId === undefined ? undefined : runUlids.value.get(projectId.value);
  if (listedUlid !== undefined && ulidSetting !== undefined) {
    if (mainUlid !== '' && mainUlid !== listedUlid) {
      problems.push(
        `${ulidSetting.label} and ${runUlids.label} name different runs of ${projectId?.value ?? ''}`,
      );
    }
  } else if (listedUlid !== undefined) {
    mainUlid = listedUlid;
  }
  for (const code of runUlids.value.keys()) {
    if (code !== projectId?.value && !extraCodes.includes(code)) {
      warnings.push(
        `Ignored the run of ${code} in ${runUlids.label}: ${code} is not the project nor one of projects`,
      );
    }
  }
  const creating = extraCodes.filter((code) => !runUlids.value.has(code));

  const ci = detectCiSource(env);
  const defaultName = () =>
    ci.buildName ?? defaultRunName(context.now === undefined ? new Date() : context.now());
  const newRun =
    mainUlid === undefined || creating.length > 0
      ? resolveNewRun(settings, runOptions, defaultName)
      : undefined;
  let run: ResolvedRun;
  if (mainUlid === undefined && newRun !== undefined) {
    run = newRun;
    const projectFields = PROJECT_RUN_FIELDS.filter((field) =>
      field === 'configurationUlids'
        ? newRun.configurationUlids.length > 0
        : newRun[field] !== undefined,
    );
    if (creating.length > 0 && projectFields.length > 0) {
      warnings.push(
        `Sent ${joinNames(projectFields)} with the run of ${projectId?.value ?? ''} only: they belong to one project. Create the runs of ${joinNames(creating)} with their own (probara run create --project <code>) and pass them in run.ulids`,
      );
    }
  } else {
    run = { ulid: mainUlid ?? '' };
    // The name and tags still name the new runs of other projects.
    const usedElsewhere: readonly string[] = creating.length > 0 ? ['name', 'tags'] : [];
    const ignored = NEW_RUN_FIELDS.filter(
      ([field, variable]) =>
        !usedElsewhere.includes(field) &&
        (runOptions[field] !== undefined || settings.read(variable) !== undefined),
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
  const closeRunSetting = settings.boolean(options.closeRun, 'closeRun', 'PROBARA_CLOSE_RUN');
  const closeRun = closeRunSetting?.value ?? mainUlid === undefined;
  const projects: ResolvedProject[] = extraCodes.map((code) => {
    const ulid = runUlids.value.get(code);
    return {
      projectId: code,
      run:
        ulid !== undefined
          ? { ulid }
          : { name: newRun?.name ?? '', configurationUlids: [], tags: newRun?.tags ?? [] },
      closeRun: closeRunSetting?.value ?? ulid === undefined,
    };
  });
  const debug = settings.boolean(options.debug, 'debug', 'PROBARA_DEBUG')?.value ?? false;
  const uploadAttachments =
    settings.boolean(options.uploadAttachments, 'uploadAttachments', 'PROBARA_UPLOAD_ATTACHMENTS')
      ?.value ?? true;
  const rootDir = settings.optionalString(options.rootDir, 'rootDir');
  const clientName = settings.optionalString(options.clientName, 'clientName');

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
  const attachmentConcurrency = settings.number(
    options.attachmentConcurrency,
    'attachmentConcurrency',
    DEFAULT_ATTACHMENT_CONCURRENCY,
    (value) => Number.isInteger(value) && value >= 1 && value <= MAX_ATTACHMENT_CONCURRENCY,
    `an integer from 1 to ${MAX_ATTACHMENT_CONCURRENCY}`,
  );

  const statusMapping = resolveStatusMapping(settings, options.statusMapping);
  const statusFilter = resolveStatusFilter(settings, options.statusFilter);

  if (problems.length > 0 || apiToken === undefined || projectId === undefined) {
    return { ok: false, disabled: false, problems, warnings };
  }

  const clientNameLine = clientName === undefined ? '' : toSingleLine(clientName);
  const config: ResolvedConfig = {
    apiToken: apiToken.value,
    projectId: projectId.value,
    baseUrl,
    run,
    source,
    createMissingCases,
    ...(suiteUlid === undefined ? {} : { suiteUlid }),
    closeRun,
    rootDir: resolve(rootDir ?? process.cwd()),
    debug,
    ...(clientNameLine === '' ? {} : { clientName: clientNameLine }),
    chunkSize,
    timeoutMs,
    maxRetries,
    uploadAttachments,
    attachmentConcurrency,
    statusMapping,
    statusFilter,
    projects,
  };
  return { ok: true, config: freeze(config), warnings };
}
