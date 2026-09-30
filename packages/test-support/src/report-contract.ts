/**
 * The request rules of the Probara API that the fake enforces, written after the server's own
 * schemas (cynch-tcms `packages/shared/src/api/reports.ts`, `result-details.ts`, `runs.ts`,
 * `test-cases.ts` and `schemas/trimmed-name-record.ts`): strict objects, the limits of every field,
 * the refinements the OpenAPI states in prose only, and the per-report totals. The fake answers 422
 * with the first issue, like the server refuses a whole request for one field.
 */

const STATUSES = new Set(['passed', 'failed', 'skipped', 'blocked']);
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
// eslint-disable-next-line no-control-regex -- the class IS the set the server refuses in a key
const CONTROL = /[\u0000-\u001f\u007f]/;
const OFFSET_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Per-report totals (`REPORT_*_MAX_TOTAL`). */
export const REPORT_RESULT_STEPS_MAX_TOTAL = 10_000;
export const REPORT_CASE_STEPS_MAX_TOTAL = 10_000;
export const REPORT_CASE_TAGS_MAX_TOTAL = 1000;

/** The system fields a report's `case.fields` may name, besides custom field titles. */
export const SYSTEM_CASE_FIELDS: readonly string[] = [
  'priority',
  'severity',
  'type',
  'layer',
  'behavior',
  'status',
  'preconditions',
  'postconditions',
  'is_flaky',
];

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collects issues with the path of the field at fault. */
class Issues {
  readonly list: string[] = [];

  add(path: string, message: string): void {
    this.list.push(`${path}: ${message}`);
  }

  /** An object with only `keys`, else an issue. */
  strict(value: unknown, path: string, keys: readonly string[]): value is Json {
    if (!isObject(value)) {
      this.add(path, 'must be an object');
      return false;
    }
    const unknown = Object.keys(value).filter((key) => !keys.includes(key));
    if (unknown.length > 0) this.add(path, `unrecognized keys ${unknown.join(', ')}`);
    return unknown.length === 0;
  }

  /** A string of `min..max` code units, trimmed first when `trim`. */
  text(
    value: unknown,
    path: string,
    { min = 0, max, trim = false, nullable = false }: TextRule,
  ): void {
    if (value === undefined || (nullable && value === null)) return;
    if (typeof value !== 'string') {
      this.add(path, 'must be a string');
      return;
    }
    const text = trim ? value.trim() : value;
    if (text.length < min) this.add(path, `must have at least ${min} characters`);
    if (text.length > max) this.add(path, `must have at most ${max} characters`);
  }

  integer(value: unknown, path: string): void {
    if (value === undefined) return;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      this.add(path, 'must be an integer of 0 or more');
    }
  }

  array(value: unknown, path: string, max: number): value is unknown[] {
    if (!Array.isArray(value)) {
      this.add(path, 'must be a list');
      return false;
    }
    if (value.length > max) this.add(path, `must hold at most ${max} items`);
    return true;
  }
}

interface TextRule {
  min?: number;
  max: number;
  trim?: boolean;
  nullable?: boolean;
}

/**
 * A `name → value` record whose names are trimmed (result parameters, case fields): at most
 * `maxItems`, names 1..`nameMax` once trimmed, never `__proto__`, never two equal once trimmed
 * (and compared ignoring case when `caseInsensitive`), values strings of at most `valueMax`.
 */
function checkNamedRecord(
  issues: Issues,
  value: unknown,
  path: string,
  rule: {
    maxItems: number;
    nameMax: number;
    valueMax: number;
    trimValue: boolean;
    caseInsensitive: boolean;
  },
): void {
  if (value === undefined) return;
  if (!isObject(value)) {
    issues.add(path, 'must be an object');
    return;
  }
  if (Object.hasOwn(value, '__proto__')) issues.add(path, 'a name cannot be __proto__');
  const names = Object.keys(value);
  if (names.length > rule.maxItems) issues.add(path, `must hold at most ${rule.maxItems} names`);
  const seen = new Set<string>();
  for (const raw of names) {
    // Refused above: the server's record never sees that key.
    if (raw === '__proto__') continue;
    const name = raw.trim();
    if (name.length === 0 || name.length > rule.nameMax) {
      issues.add(`${path}.${raw}`, `a name has 1–${rule.nameMax} characters once trimmed`);
      continue;
    }
    if (name === '__proto__') issues.add(`${path}.${raw}`, 'a name cannot be __proto__');
    const key = rule.caseInsensitive ? name.toLowerCase() : name;
    if (seen.has(key)) issues.add(`${path}.${raw}`, 'repeats another name once trimmed');
    seen.add(key);
    issues.text(value[raw], `${path}.${raw}`, { max: rule.valueMax, trim: rule.trimValue });
  }
}

const STEP_KEYS = ['action', 'status', 'durationMs', 'error', 'expected', 'data', 'steps'];

/** Steps of a tree, every level counted. */
export function countSteps(steps: unknown): number {
  if (!Array.isArray(steps)) return 0;
  return steps.reduce<number>(
    (total, step) => total + 1 + (isObject(step) ? countSteps(step.steps) : 0),
    0,
  );
}

function checkSteps(issues: Issues, steps: unknown, path: string, level: number): void {
  if (!issues.array(steps, path, 200)) return;
  steps.forEach((step, index) => {
    const at = `${path}[${index}]`;
    // The deepest level has no `steps` key at all.
    const keys = level === 10 ? STEP_KEYS.filter((key) => key !== 'steps') : STEP_KEYS;
    if (!issues.strict(step, at, keys)) return;
    issues.text(step.action, `${at}.action`, { min: 1, max: 2000, trim: true });
    if (step.action === undefined) issues.add(`${at}.action`, 'is required');
    if (!STATUSES.has(step.status as string)) issues.add(`${at}.status`, 'is not a status');
    issues.integer(step.durationMs, `${at}.durationMs`);
    issues.text(step.error, `${at}.error`, { max: 4000 });
    issues.text(step.expected, `${at}.expected`, { max: 2000 });
    issues.text(step.data, `${at}.data`, { max: 2000 });
    if (step.steps !== undefined) checkSteps(issues, step.steps, `${at}.steps`, level + 1);
  });
}

function checkCase(issues: Issues, value: unknown, path: string): void {
  if (value === undefined) return;
  if (!issues.strict(value, path, ['description', 'tags', 'fields', 'steps'])) return;
  issues.text(value.description, `${path}.description`, { max: 4000, nullable: true });
  if (value.tags !== undefined && issues.array(value.tags, `${path}.tags`, 50)) {
    value.tags.forEach((tag, index) => {
      issues.text(tag, `${path}.tags[${index}]`, { min: 1, max: 80, trim: true });
    });
  }
  checkNamedRecord(issues, value.fields, `${path}.fields`, {
    maxItems: 50,
    nameMax: 200,
    valueMax: 4000,
    trimValue: false,
    caseInsensitive: true,
  });
  if (value.steps !== undefined && issues.array(value.steps, `${path}.steps`, 500)) {
    value.steps.forEach((step, index) => {
      const at = `${path}.steps[${index}]`;
      if (!issues.strict(step, at, ['action', 'expected', 'data'])) return;
      issues.text(step.action, `${at}.action`, { min: 1, max: 2000, trim: true });
      if (step.action === undefined) issues.add(`${at}.action`, 'is required');
      issues.text(step.expected, `${at}.expected`, { max: 2000, nullable: true });
      issues.text(step.data, `${at}.data`, { max: 2000, nullable: true });
    });
  }
}

const ENTRY_KEYS = [
  'caseDisplayId',
  'automationKey',
  'title',
  'suitePath',
  'status',
  'durationMs',
  'notes',
  'executedAt',
  'parameters',
  'steps',
  'case',
];

function checkEntry(issues: Issues, entry: unknown, path: string): void {
  if (!issues.strict(entry, path, ENTRY_KEYS)) return;
  issues.text(entry.caseDisplayId, `${path}.caseDisplayId`, { min: 1, max: 64, trim: true });
  issues.text(entry.automationKey, `${path}.automationKey`, { min: 1, max: 1024, trim: true });
  if (typeof entry.automationKey === 'string' && CONTROL.test(entry.automationKey)) {
    issues.add(`${path}.automationKey`, 'holds a control character');
  }
  if (entry.caseDisplayId === undefined && entry.automationKey === undefined) {
    issues.add(path, 'needs a caseDisplayId or an automationKey');
  }
  issues.text(entry.title, `${path}.title`, { min: 1, max: 400, trim: true });
  if (entry.suitePath !== undefined && issues.array(entry.suitePath, `${path}.suitePath`, 10)) {
    entry.suitePath.forEach((level, index) => {
      issues.text(level, `${path}.suitePath[${index}]`, { min: 1, max: 255, trim: true });
    });
  }
  if (!STATUSES.has(entry.status as string)) issues.add(`${path}.status`, 'is not a status');
  issues.integer(entry.durationMs, `${path}.durationMs`);
  issues.text(entry.notes, `${path}.notes`, { max: 4000 });
  if (
    entry.executedAt !== undefined &&
    (typeof entry.executedAt !== 'string' || !OFFSET_DATE_TIME.test(entry.executedAt))
  ) {
    issues.add(`${path}.executedAt`, 'is not a date-time with an offset');
  }
  checkNamedRecord(issues, entry.parameters, `${path}.parameters`, {
    maxItems: 20,
    nameMax: 100,
    valueMax: 500,
    trimValue: true,
    caseInsensitive: false,
  });
  if (entry.steps !== undefined) {
    checkSteps(issues, entry.steps, `${path}.steps`, 1);
    if (countSteps(entry.steps) > 200) {
      issues.add(`${path}.steps`, 'each result carries at most 200 steps across all levels');
    }
  }
  checkCase(issues, entry.case, `${path}.case`);
}

const REFERENCE_FORMS = [
  ['environmentId', 'environment'],
  ['milestoneId', 'milestone'],
  ['planUlid', 'plan'],
  ['configurationUlids', 'configurations'],
] as const;

/** The fields a new run describes, on `POST /runs` and in a report's run-create shape. */
function checkNewRun(issues: Issues, run: Json, path: string): void {
  issues.text(run.name, `${path}.name`, { min: 1, max: 200, trim: true });
  issues.text(run.description, `${path}.description`, { max: 2000, nullable: true });
  for (const field of ['environmentId', 'milestoneId', 'planUlid']) {
    const value = run[field];
    if (value !== undefined && value !== null && (typeof value !== 'string' || !ULID.test(value))) {
      issues.add(`${path}.${field}`, 'is not a ULID');
    }
  }
  issues.text(run.environment, `${path}.environment`, { max: 80, nullable: true });
  issues.text(run.milestone, `${path}.milestone`, { min: 1, max: 255, trim: true });
  issues.text(run.plan, `${path}.plan`, { min: 1, max: 200, trim: true });
  if (run.configurationUlids !== undefined) {
    if (issues.array(run.configurationUlids, `${path}.configurationUlids`, 20)) {
      for (const ulid of run.configurationUlids) {
        if (typeof ulid !== 'string' || !ULID.test(ulid)) {
          issues.add(`${path}.configurationUlids`, 'holds a value that is not a ULID');
        }
      }
    }
  }
  if (run.configurations !== undefined) {
    if (issues.array(run.configurations, `${path}.configurations`, 20)) {
      const groups = new Set<string>();
      run.configurations.forEach((configuration, index) => {
        const at = `${path}.configurations[${index}]`;
        if (!issues.strict(configuration, at, ['group', 'name'])) return;
        issues.text(configuration.group, `${at}.group`, { min: 1, max: 120, trim: true });
        issues.text(configuration.name, `${at}.name`, { min: 1, max: 120, trim: true });
        const group = typeof configuration.group === 'string' ? configuration.group.trim() : '';
        if (groups.has(group)) issues.add(`${path}.configurations`, 'names a group twice');
        groups.add(group);
      });
    }
  }
  if (run.tags !== undefined && run.tags !== null && issues.array(run.tags, `${path}.tags`, 50)) {
    run.tags.forEach((tag, index) => {
      issues.text(tag, `${path}.tags[${index}]`, { min: 1, max: 80 });
    });
  }
  for (const [byUlid, byName] of REFERENCE_FORMS) {
    const given = (value: unknown) => value !== undefined && value !== null;
    if (given(run[byUlid]) && given(run[byName])) {
      issues.add(`${path}.${byName}`, `not together with ${byUlid}`);
    }
  }
}

const SOURCE = ['source'];
const REPORT_NEW_RUN_KEYS = [
  'name',
  'description',
  'environmentId',
  'environment',
  'milestoneId',
  'milestone',
  'plan',
  'configurationUlids',
  'configurations',
  'tags',
  ...SOURCE,
];

/** Why the server would refuse this report body (422), in order; none when it accepts it. */
export function reportIssues(body: unknown): string[] {
  const issues = new Issues();
  if (!isObject(body)) return ['body: must be an object'];
  const { run, results } = body;
  if (isObject(run) && 'ulid' in run) {
    issues.strict(run, 'run', ['ulid', ...SOURCE]);
  } else if (issues.strict(run, 'run', REPORT_NEW_RUN_KEYS)) {
    checkNewRun(issues, run, 'run');
  }
  if (issues.array(results, 'results', 500)) {
    if (results.length === 0) issues.add('results', 'must hold at least 1 item');
    results.forEach((entry, index) => {
      checkEntry(issues, entry, `results[${index}]`);
    });
    const entries = results.filter(isObject);
    const resultSteps = entries.reduce((total, entry) => total + countSteps(entry.steps), 0);
    const caseOf = (entry: Json) => (isObject(entry.case) ? entry.case : {});
    const lengthOf = (value: unknown) => (Array.isArray(value) ? value.length : 0);
    const caseSteps = entries.reduce((total, entry) => total + lengthOf(caseOf(entry).steps), 0);
    const caseTags = entries.reduce((total, entry) => total + lengthOf(caseOf(entry).tags), 0);
    if (resultSteps > REPORT_RESULT_STEPS_MAX_TOTAL) {
      issues.add(
        'results',
        `a report carries at most ${REPORT_RESULT_STEPS_MAX_TOTAL} result steps`,
      );
    }
    if (caseSteps > REPORT_CASE_STEPS_MAX_TOTAL) {
      issues.add('results', `a report carries at most ${REPORT_CASE_STEPS_MAX_TOTAL} case steps`);
    }
    if (caseTags > REPORT_CASE_TAGS_MAX_TOTAL) {
      issues.add(
        'results',
        `a report carries at most ${REPORT_CASE_TAGS_MAX_TOTAL} case tag names`,
      );
    }
  }
  return issues.list;
}

/** Why the server would refuse this `POST /runs` body (422), besides its missing cases. */
export function createRunIssues(body: unknown): string[] {
  const issues = new Issues();
  if (!isObject(body)) return ['body: must be an object'];
  checkNewRun(issues, body, 'body');
  return issues.list;
}

/**
 * The warnings of a report whose entries create cases: each field of `case.fields` that is
 * neither a system field nor one of `customFields` (ignoring case) is skipped, like the server
 * skips a field it cannot resolve.
 */
export function caseFieldWarnings(fields: unknown, customFields: readonly string[]): string[] {
  if (!isObject(fields)) return [];
  const known = new Set([...SYSTEM_CASE_FIELDS, ...customFields].map((name) => name.toLowerCase()));
  return Object.keys(fields)
    .filter((name) => !known.has(name.trim().toLowerCase()))
    .map((name) => `Unknown field "${name.trim()}" was skipped`);
}
