import type { ReportResultEntry, ResultStatus } from './api.js';
import type { AttachmentInput } from './attachments.js';
import {
  buildAutomationKey,
  fitAutomationKey,
  normalizeTestFile,
  normalizeTitlePath,
  type TestIdentity,
} from './automation-key.js';
import {
  MAX_CASE_DISPLAY_ID_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_SUITE_PATH_DEPTH,
  MAX_SUITE_SEGMENT_LENGTH,
  MAX_TITLE_LENGTH,
} from './limits.js';
import { stripAnsi, toMultiline, toSingleLine, toWellFormed, truncate } from './text.js';

/** An error of a test: a message, or a message and a stack (the stack usually repeats it). */
export type TestError = string | { message?: string; stack?: string };

/** One finished test, as an adapter hands it to core. */
export interface TestResultInput {
  identity: TestIdentity;
  status: ResultStatus;
  /** Explicit case link such as `PRB-12`; authoritative on the server. */
  caseDisplayId?: string;
  /**
   * More explicit case links. The result links `caseDisplayId` and every id of this list, once
   * each (blank ones are ignored), and the reporter sends it once per case (see
   * {@link fanOutByCase}).
   */
  caseDisplayIds?: readonly string[];
  /** Replaces the key built from `identity`. */
  automationKey?: string;
  /** Title of a case the report creates. Defaults to the last title segment (with parameters). */
  title?: string;
  /** Suites of a case the report creates. Defaults to the file, then all but the last title segment. */
  suitePath?: readonly string[];
  durationMs?: number;
  /**
   * When the test started; sent as `executedAt`. A string without a UTC offset is read as host
   * local time: prefer a `Date` or epoch ms.
   */
  startedAt?: Date | string | number;
  /**
   * Written into the notes: a message or `{ message, stack }`, or a list of them (every error of a
   * test, in order). `null` counts as no error.
   */
  error?: TestError | readonly TestError[] | null;
  /** Extra text, appended after the error. */
  notes?: string;
  /**
   * Files of the result (Playwright's `result.attachments` fits as is), uploaded after its report
   * records it. Never part of the report entry.
   */
  attachments?: readonly AttachmentInput[];
}

export interface ReportEntryContext {
  /** Directory file paths are relative to. Defaults to `process.cwd()`. */
  rootDir?: string;
}

export interface ReportEntryConversion {
  entry: ReportResultEntry;
  /** Optional fields that were dropped because they could not be sent. */
  warnings: string[];
}

/** Every status a result can have, in the order messages list them. */
export const RESULT_STATUSES: readonly ResultStatus[] = ['passed', 'failed', 'skipped', 'blocked'];
const SUITE_LEVEL_SEPARATOR = ' > ';
const NOTES_TRUNCATION_MARKER = '\n…[truncated]';

export function isResultStatus(status: unknown): status is ResultStatus {
  return typeof status === 'string' && (RESULT_STATUSES as readonly string[]).includes(status);
}

function toSuitePath(segments: readonly string[]): string[] | undefined {
  const levels = segments
    .map((segment) => truncate(toSingleLine(segment), MAX_SUITE_SEGMENT_LENGTH))
    .filter((segment) => segment !== '');
  if (levels.length > MAX_SUITE_PATH_DEPTH) {
    const merged = levels.splice(MAX_SUITE_PATH_DEPTH - 1).join(SUITE_LEVEL_SEPARATOR);
    levels.push(truncate(merged, MAX_SUITE_SEGMENT_LENGTH));
  }
  return levels.length > 0 ? levels : undefined;
}

function toExecutedAt(startedAt: Date | string | number): string | undefined {
  const date = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (Number.isNaN(date.getTime())) return undefined;
  const iso = date.toISOString();
  // Years beyond 0000..9999 render as `+275760-...`, which is not an RFC 3339 date-time.
  return /^\d{4}-/.test(iso) ? iso : undefined;
}

function errorParts(error: TestError): string[] {
  if (typeof error === 'string') return [stripAnsi(error)];
  const message = stripAnsi(error.message ?? '').trim();
  const stack = stripAnsi(error.stack ?? '');
  // Most stacks start with `Error: <message>`; send the message once.
  return message !== '' && !stack.includes(message) ? [message, stack] : [stack];
}

function toNotes(input: TestResultInput): string | undefined {
  const { error } = input;
  const errors: readonly TestError[] =
    error === undefined || error === null ? [] : isErrorList(error) ? error : [error];
  const parts = errors.flatMap(errorParts);
  if (input.notes !== undefined) parts.push(input.notes);
  const notes = parts
    .map((part) => toMultiline(part).trimEnd().replace(/^\n+/, ''))
    .filter((part) => part.trim() !== '')
    .join('\n\n');
  return notes === '' ? undefined : truncate(notes, MAX_NOTES_LENGTH, NOTES_TRUNCATION_MARKER);
}

function isErrorList(error: TestError | readonly TestError[]): error is readonly TestError[] {
  return Array.isArray(error);
}

const NOT_A_LIST = 'Ignored a caseDisplayIds that is not a list';
const NOT_STRINGS = 'Ignored caseDisplayIds items that are not strings';

/**
 * The cases `input` links: `caseDisplayId`, then `caseDisplayIds`, trimmed, non-blank, once each.
 * An untyped adapter may pass anything: a `caseDisplayIds` that is not a list (a string would
 * otherwise link each of its characters) and items that are not strings are left out, and
 * `warnings` says so.
 */
function linkedCaseIds(input: TestResultInput, warnings: string[]): string[] {
  const list: unknown = input.caseDisplayIds;
  let raws: unknown[] = [];
  if (Array.isArray(list)) raws = list;
  else if (list !== undefined) warnings.push(NOT_A_LIST);
  if (raws.some((raw) => typeof raw !== 'string')) warnings.push(NOT_STRINGS);
  const ids: string[] = [];
  for (const raw of [input.caseDisplayId ?? '', ...raws]) {
    if (typeof raw !== 'string') continue;
    const id = toWellFormed(raw).trim();
    if (id !== '' && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Splits a result that links several cases into one result per case, in the order of
 * `caseDisplayId`, then `caseDisplayIds`. Each copy keeps everything else (the same automation key,
 * status, notes and attachments, so every case gets the files). A result that links at most one
 * case comes back as one result, without `caseDisplayIds`. Why ids were left out (a
 * `caseDisplayIds` that is not a list, items that are not strings) is pushed to `warnings`.
 */
export function fanOutByCase(input: TestResultInput, warnings: string[] = []): TestResultInput[] {
  const { caseDisplayIds, ...single } = input;
  if (caseDisplayIds === undefined) return [input];
  const ids = linkedCaseIds(input, warnings);
  if (ids.length === 0) return [single];
  return ids.map((caseDisplayId) => ({ ...single, caseDisplayId }));
}

/**
 * Converts an adapter's result into a report entry that satisfies every contract limit.
 * Invalid optional fields are dropped and described in `warnings`.
 *
 * @throws TypeError on an unknown `status`, an identity without a title segment, or a result that
 * links several cases (split it with {@link fanOutByCase} first): adapter bugs.
 */
export function toReportEntry(
  input: TestResultInput,
  context: ReportEntryContext = {},
): ReportEntryConversion {
  const warnings: string[] = [];
  if (!isResultStatus(input.status)) {
    throw new TypeError(`Unknown result status "${String(input.status)}"`);
  }

  const rootDir = context.rootDir ?? process.cwd();
  const entry: ReportResultEntry = { status: input.status };

  const linked = linkedCaseIds(input, warnings);
  if (linked.length > 1) {
    throw new TypeError(
      `The result links ${linked.length} cases: split it with fanOutByCase, one entry per case`,
    );
  }
  const rawCaseDisplayId = linked[0] ?? input.caseDisplayId;
  if (rawCaseDisplayId !== undefined) {
    const caseDisplayId = toWellFormed(rawCaseDisplayId).trim();
    if (caseDisplayId === '') warnings.push('Ignored a blank caseDisplayId');
    else if (caseDisplayId.length > MAX_CASE_DISPLAY_ID_LENGTH) {
      warnings.push(`Ignored a caseDisplayId longer than ${MAX_CASE_DISPLAY_ID_LENGTH} characters`);
    } else entry.caseDisplayId = caseDisplayId;
  }

  const overrideKey = input.automationKey === undefined ? '' : toSingleLine(input.automationKey);
  if (input.automationKey !== undefined && overrideKey === '') {
    warnings.push('Ignored a blank automationKey; used the key built from the test');
  }
  entry.automationKey =
    overrideKey === ''
      ? buildAutomationKey(input.identity, { rootDir })
      : fitAutomationKey(overrideKey);

  const titleSegments = normalizeTitlePath(input.identity);
  const title = truncate(
    toSingleLine(input.title ?? titleSegments[titleSegments.length - 1] ?? ''),
    MAX_TITLE_LENGTH,
  );
  if (title !== '') entry.title = title;

  const suitePath = toSuitePath(
    input.suitePath ?? [
      normalizeTestFile(input.identity.file, rootDir),
      ...titleSegments.slice(0, -1),
    ],
  );
  if (suitePath !== undefined) entry.suitePath = suitePath;

  if (input.durationMs !== undefined) {
    if (Number.isFinite(input.durationMs))
      entry.durationMs = Math.max(0, Math.round(input.durationMs));
    else warnings.push('Ignored a durationMs that is not a finite number');
  }

  const notes = toNotes(input);
  if (notes !== undefined) entry.notes = notes;

  if (input.startedAt !== undefined) {
    const executedAt = toExecutedAt(input.startedAt);
    if (executedAt === undefined) warnings.push('Ignored a startedAt that is not a valid date');
    else entry.executedAt = executedAt;
  }

  return { entry, warnings };
}
