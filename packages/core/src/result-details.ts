/**
 * The details a result may carry besides its status: the parameters it ran with, its step tree
 * (with files per step) and the case the report creates for it. Each is kept within the contract:
 * what cannot be sent is trimmed, cut or left out, with a warning, and never fails the entry.
 */
import type { ReportResultEntry, ResultStatus } from './api.js';
import type { AttachmentInput } from './attachments.js';
import {
  MAX_CASE_DESCRIPTION_LENGTH,
  MAX_CASE_FIELD_NAME_LENGTH,
  MAX_CASE_FIELD_VALUE_LENGTH,
  MAX_CASE_FIELDS,
  MAX_CASE_STEPS,
  MAX_CASE_TAG_LENGTH,
  MAX_CASE_TAGS,
  MAX_PARAMETER_NAME_LENGTH,
  MAX_PARAMETER_VALUE_LENGTH,
  MAX_PARAMETERS,
  MAX_STEP_ACTION_LENGTH,
  MAX_STEP_DEPTH,
  MAX_STEP_ERROR_LENGTH,
  MAX_STEP_TEXT_LENGTH,
  MAX_STEPS_PER_RESULT,
} from './limits.js';
import { stripAnsi, toMultiline, toSingleLine, truncate } from './text.js';

/** An error of a test: a message, or a message and a stack (the stack usually repeats it). */
export type TestError = string | { message?: string; stack?: string };

/** One step of a result, as an adapter hands it to core. */
export interface TestStepInput {
  /** What the step did, such as `Open the cart`. */
  action: string;
  status: ResultStatus;
  durationMs?: number;
  /** What made it fail: written like the error of a result, message then stack. */
  error?: TestError | readonly TestError[] | null;
  /** The expected result of the step. */
  expected?: string;
  /** The data the step used. */
  data?: string;
  /** Its sub-steps. */
  steps?: readonly TestStepInput[];
  /** Files of the step, uploaded to it after its result is recorded. */
  attachments?: readonly AttachmentInput[];
}

/** One step of the case a report creates. */
export interface TestCaseStepInput {
  action: string;
  expected?: string;
  data?: string;
}

/**
 * What the case a report creates for a result starts with. Probara applies it only when the entry
 * creates the case; an existing case is never changed.
 */
export interface TestCaseInput {
  description?: string;
  /** Tag names; unknown ones are added to the organization's tags. */
  tags?: readonly string[];
  /**
   * Field values by field name: a system field (`priority`, `severity`, `type`, `layer`,
   * `behavior`, `status`, `preconditions`, `postconditions`, `is_flaky`) or a custom field title,
   * matched ignoring case. What Probara cannot resolve is skipped and listed in its warnings.
   */
  fields?: Readonly<Record<string, string>>;
  steps?: readonly TestCaseStepInput[];
}

/** The files of one step: `stepIndex` is its pre-order index; none when the step was dropped. */
export interface StepAttachments {
  stepIndex?: number;
  attachments: unknown;
}

type ReportStep = NonNullable<ReportResultEntry['steps']>[number];
type ReportCase = NonNullable<ReportResultEntry['case']>;

/** What a report entry adds up to toward the per-report totals. */
export interface EntryTotals {
  resultSteps: number;
  caseSteps: number;
  caseTags: number;
}

const TRUNCATION_MARKER = '\n…[truncated]';
/** The one name a record must never carry: assigning it sets a prototype instead of a key. */
const PROTO = '__proto__';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pushes `message` once: a message tells what kind of value was left out, not how many. */
function warnOnce(warnings: string[], message: string): void {
  if (!warnings.includes(message)) warnings.push(message);
}

/** Free text trimmed, or `undefined` when blank. */
function textOf(value: string, max: number): string | undefined {
  const text = toMultiline(value).trim();
  return text === '' ? undefined : truncate(text, max);
}

/** A string, number or boolean as text; `undefined` for anything else. */
function scalarText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** The message and stack of one error, the message once when the stack repeats it. */
export function errorParts(error: TestError): string[] {
  if (typeof error === 'string') return [stripAnsi(error)];
  const message = stripAnsi(error.message ?? '').trim();
  const stack = stripAnsi(error.stack ?? '');
  // Most stacks start with `Error: <message>`; send the message once.
  return message !== '' && !stack.includes(message) ? [message, stack] : [stack];
}

/**
 * The text of an error or a list of errors: each message and stack, in order, as free text. The
 * notes of a result and the error of a step are written alike.
 */
export function errorText(error: TestError | readonly TestError[] | null | undefined): string[] {
  if (error === undefined || error === null) return [];
  const errors: readonly TestError[] = Array.isArray(error)
    ? (error as readonly TestError[])
    : [error as TestError];
  return errors
    .filter((item) => typeof item === 'string' || isRecord(item))
    .flatMap(errorParts)
    .map((part) => toMultiline(part).trimEnd().replace(/^\n+/, ''))
    .filter((part) => part.trim() !== '');
}

/**
 * The parameters of a result: names on one line, values trimmed, each within its limit; blank
 * names, `__proto__`, repeated names and values that are not text are left out, like those beyond
 * the first {@link MAX_PARAMETERS}.
 */
export function toParameters(raw: unknown, warnings: string[]): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    warnOnce(warnings, 'Ignored parameters that are not an object');
    return undefined;
  }
  const parameters: Record<string, string> = {};
  let count = 0;
  for (const [rawName, rawValue] of Object.entries(raw)) {
    let name = toSingleLine(rawName);
    const value = scalarText(rawValue);
    if (name === '') {
      warnOnce(warnings, 'Ignored a parameter with a blank name');
      continue;
    }
    if (name === PROTO) {
      warnOnce(warnings, 'Ignored a parameter named __proto__');
      continue;
    }
    if (value === undefined) {
      warnOnce(warnings, 'Ignored a parameter whose value is not a string');
      continue;
    }
    if (name.length > MAX_PARAMETER_NAME_LENGTH) {
      warnOnce(
        warnings,
        `Truncated a parameter name longer than ${MAX_PARAMETER_NAME_LENGTH} characters`,
      );
      name = truncate(name, MAX_PARAMETER_NAME_LENGTH);
    }
    if (Object.hasOwn(parameters, name)) {
      warnOnce(warnings, 'Ignored a parameter whose name repeats another once trimmed');
      continue;
    }
    if (count === MAX_PARAMETERS) {
      warnOnce(warnings, `Dropped the parameters beyond the first ${MAX_PARAMETERS} of a result`);
      break;
    }
    parameters[name] = truncate(toMultiline(value).trim(), MAX_PARAMETER_VALUE_LENGTH);
    count += 1;
  }
  return count === 0 ? undefined : parameters;
}

/** The step tree of a result and the files of its steps (see {@link toSteps}). */
export interface StepConversion {
  steps?: ReportStep[];
  stepAttachments: StepAttachments[];
}

const INVALID_STEP =
  'Dropped a step without an action or a status (passed, failed, skipped, blocked), and its sub-steps';

/**
 * The step tree of a result within the contract: actions trimmed and cut, errors written like
 * notes, at most {@link MAX_STEP_DEPTH} levels and {@link MAX_STEPS_PER_RESULT} steps in pre-order.
 * A step without an action or a valid status is dropped with its sub-steps. The files of each kept
 * step come with its pre-order index (the `stepIndex` of their commit); those of a dropped step
 * without one, so they are attached to the result instead of being lost.
 */
export function toSteps(raw: unknown, warnings: string[]): StepConversion {
  const stepAttachments: StepAttachments[] = [];
  if (raw === undefined) return { stepAttachments };
  if (!Array.isArray(raw)) {
    warnOnce(warnings, 'Ignored steps that are not a list');
    return { stepAttachments };
  }
  let count = 0;

  /** Keeps the files of a dropped subtree for the result. */
  const orphan = (item: unknown): void => {
    if (!isRecord(item)) return;
    if (item.attachments !== undefined) stepAttachments.push({ attachments: item.attachments });
    if (Array.isArray(item.steps)) for (const child of item.steps) orphan(child);
  };

  const visit = (list: readonly unknown[], depth: number): ReportStep[] => {
    const steps: ReportStep[] = [];
    for (const item of list) {
      const action =
        isRecord(item) && typeof item.action === 'string' ? toMultiline(item.action).trim() : '';
      const status = isRecord(item) ? item.status : undefined;
      if (!isRecord(item) || action === '' || !isStatus(status)) {
        warnOnce(warnings, INVALID_STEP);
        orphan(item);
        continue;
      }
      if (depth > MAX_STEP_DEPTH) {
        warnOnce(warnings, `Dropped the steps nested deeper than ${MAX_STEP_DEPTH} levels`);
        orphan(item);
        continue;
      }
      if (count === MAX_STEPS_PER_RESULT) {
        warnOnce(
          warnings,
          `Dropped the steps beyond the first ${MAX_STEPS_PER_RESULT} of a result`,
        );
        orphan(item);
        continue;
      }
      const stepIndex = count;
      count += 1;
      const step: ReportStep = { action: truncate(action, MAX_STEP_ACTION_LENGTH), status };
      const { durationMs } = item;
      if (typeof durationMs === 'number' && Number.isFinite(durationMs)) {
        step.durationMs = Math.max(0, Math.round(durationMs));
      } else if (durationMs !== undefined) {
        warnOnce(warnings, 'Ignored a step durationMs that is not a finite number');
      }
      const error = errorText(item.error as TestStepInput['error']).join('\n\n');
      if (error !== '') step.error = truncate(error, MAX_STEP_ERROR_LENGTH, TRUNCATION_MARKER);
      for (const field of ['expected', 'data'] as const) {
        const value = item[field];
        const text = typeof value === 'string' ? textOf(value, MAX_STEP_TEXT_LENGTH) : undefined;
        if (text !== undefined) step[field] = text;
        else if (value !== undefined && typeof value !== 'string') {
          warnOnce(warnings, `Ignored a step ${field} that is not a string`);
        }
      }
      if (item.attachments !== undefined) {
        stepAttachments.push({ stepIndex, attachments: item.attachments });
      }
      if (Array.isArray(item.steps)) {
        const children = visit(item.steps, depth + 1);
        if (children.length > 0) step.steps = children;
      } else if (item.steps !== undefined) {
        warnOnce(warnings, 'Ignored sub-steps that are not a list');
      }
      steps.push(step);
    }
    return steps;
  };

  const steps = visit(raw, 1);
  return steps.length === 0 ? { stepAttachments } : { steps, stepAttachments };
}

function isStatus(value: unknown): value is ResultStatus {
  return value === 'passed' || value === 'failed' || value === 'skipped' || value === 'blocked';
}

function caseTags(raw: unknown, warnings: string[]): string[] | undefined {
  if (!Array.isArray(raw) || !raw.every((tag) => typeof tag === 'string')) {
    warnOnce(warnings, 'Ignored case tags that are not a list of strings');
    return undefined;
  }
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const name of raw) {
    const tag = truncate(toSingleLine(name), MAX_CASE_TAG_LENGTH);
    // Tag names are matched ignoring case: two spellings are one tag.
    if (tag === '' || seen.has(tag.toLowerCase())) continue;
    if (tags.length === MAX_CASE_TAGS) {
      warnOnce(warnings, `Dropped the case tags beyond the first ${MAX_CASE_TAGS}`);
      break;
    }
    seen.add(tag.toLowerCase());
    tags.push(tag);
  }
  return tags.length === 0 ? undefined : tags;
}

function caseFields(raw: unknown, warnings: string[]): Record<string, string> | undefined {
  if (!isRecord(raw)) {
    warnOnce(warnings, 'Ignored case fields that are not an object');
    return undefined;
  }
  const fields: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [rawName, rawValue] of Object.entries(raw)) {
    const name = toSingleLine(rawName);
    const value = scalarText(rawValue);
    if (name === '') {
      warnOnce(warnings, 'Ignored a case field with a blank name');
      continue;
    }
    if (name === PROTO) {
      warnOnce(warnings, 'Ignored a case field named __proto__');
      continue;
    }
    if (name.length > MAX_CASE_FIELD_NAME_LENGTH) {
      // A cut name would name no field.
      warnOnce(
        warnings,
        `Ignored a case field whose name is longer than ${MAX_CASE_FIELD_NAME_LENGTH} characters`,
      );
      continue;
    }
    if (value === undefined) {
      warnOnce(warnings, 'Ignored a case field whose value is not a string');
      continue;
    }
    if (seen.has(name.toLowerCase())) {
      warnOnce(
        warnings,
        'Ignored a case field whose name repeats another once trimmed and compared ignoring case',
      );
      continue;
    }
    if (seen.size === MAX_CASE_FIELDS) {
      warnOnce(warnings, `Dropped the case fields beyond the first ${MAX_CASE_FIELDS}`);
      break;
    }
    seen.add(name.toLowerCase());
    fields[name] = truncate(toMultiline(value).trim(), MAX_CASE_FIELD_VALUE_LENGTH);
  }
  return seen.size === 0 ? undefined : fields;
}

function caseSteps(raw: unknown, warnings: string[]): ReportCase['steps'] {
  if (!Array.isArray(raw)) {
    warnOnce(warnings, 'Ignored case steps that are not a list');
    return undefined;
  }
  const steps: NonNullable<ReportCase['steps']> = [];
  for (const item of raw as unknown[]) {
    const action =
      isRecord(item) && typeof item.action === 'string'
        ? textOf(item.action, MAX_STEP_ACTION_LENGTH)
        : undefined;
    if (!isRecord(item) || action === undefined) {
      warnOnce(warnings, 'Dropped a case step without an action');
      continue;
    }
    if (steps.length === MAX_CASE_STEPS) {
      warnOnce(warnings, `Dropped the case steps beyond the first ${MAX_CASE_STEPS}`);
      break;
    }
    const step: NonNullable<ReportCase['steps']>[number] = { action };
    for (const field of ['expected', 'data'] as const) {
      const value = item[field];
      const text = typeof value === 'string' ? textOf(value, MAX_STEP_TEXT_LENGTH) : undefined;
      if (text !== undefined) step[field] = text;
    }
    steps.push(step);
  }
  return steps.length === 0 ? undefined : steps;
}

/**
 * The case a report may create for a result, within the contract; `undefined` when nothing of it
 * can be sent. Tags are trimmed and kept once each (ignoring case), field names trimmed and kept
 * once each (ignoring case), and each part cut to its limit.
 */
export function toCase(raw: unknown, warnings: string[]): ReportCase | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    warnOnce(warnings, 'Ignored a case that is not an object');
    return undefined;
  }
  const created: ReportCase = {};
  if (typeof raw.description === 'string') {
    const description = toMultiline(raw.description).trim();
    if (description !== '') {
      created.description = truncate(description, MAX_CASE_DESCRIPTION_LENGTH, TRUNCATION_MARKER);
    }
  } else if (raw.description !== undefined) {
    warnOnce(warnings, 'Ignored a case description that is not a string');
  }
  const tags = raw.tags === undefined ? undefined : caseTags(raw.tags, warnings);
  if (tags !== undefined) created.tags = tags;
  const fields = raw.fields === undefined ? undefined : caseFields(raw.fields, warnings);
  if (fields !== undefined) created.fields = fields;
  const steps = raw.steps === undefined ? undefined : caseSteps(raw.steps, warnings);
  if (steps !== undefined) created.steps = steps;
  return Object.keys(created).length === 0 ? undefined : created;
}

function countSteps(steps: readonly ReportStep[] | undefined): number {
  return (steps ?? []).reduce((total, step) => total + 1 + countSteps(step.steps), 0);
}

/** What `entry` adds to the per-report totals: result steps of every level, case steps and tags. */
export function entryTotals(entry: ReportResultEntry): EntryTotals {
  return {
    resultSteps: countSteps(entry.steps),
    caseSteps: entry.case?.steps?.length ?? 0,
    caseTags: entry.case?.tags?.length ?? 0,
  };
}
