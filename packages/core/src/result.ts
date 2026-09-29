import type { ReportResultEntry, ResultStatus } from './api.js';
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

/** One finished test, as an adapter hands it to core. */
export interface TestResultInput {
  identity: TestIdentity;
  status: ResultStatus;
  /** Explicit case link such as `PRB-12`; authoritative on the server. */
  caseDisplayId?: string;
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
  /** `null` counts as no error. */
  error?: string | { message?: string; stack?: string } | null;
  /** Extra text, appended after the error. */
  notes?: string;
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

const RESULT_STATUSES: ReadonlySet<string> = new Set<ResultStatus>([
  'passed',
  'failed',
  'skipped',
  'blocked',
]);
const SUITE_LEVEL_SEPARATOR = ' > ';
const NOTES_TRUNCATION_MARKER = '\n…[truncated]';

function isResultStatus(status: unknown): status is ResultStatus {
  return typeof status === 'string' && RESULT_STATUSES.has(status);
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

function toNotes(input: TestResultInput): string | undefined {
  const parts: string[] = [];
  const { error } = input;
  if (typeof error === 'string') {
    parts.push(stripAnsi(error));
  } else if (error !== undefined && error !== null) {
    const message = stripAnsi(error.message ?? '').trim();
    const stack = stripAnsi(error.stack ?? '');
    // Most stacks start with `Error: <message>`; send the message once.
    if (message !== '' && !stack.includes(message)) parts.push(message);
    parts.push(stack);
  }
  if (input.notes !== undefined) parts.push(input.notes);
  const notes = parts
    .map((part) => toMultiline(part).trimEnd().replace(/^\n+/, ''))
    .filter((part) => part.trim() !== '')
    .join('\n\n');
  return notes === '' ? undefined : truncate(notes, MAX_NOTES_LENGTH, NOTES_TRUNCATION_MARKER);
}

/**
 * Converts an adapter's result into a report entry that satisfies every contract limit.
 * Invalid optional fields are dropped and described in `warnings`.
 *
 * @throws TypeError on an unknown `status` or an identity without a title segment (adapter bugs).
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

  if (input.caseDisplayId !== undefined) {
    const caseDisplayId = toWellFormed(input.caseDisplayId).trim();
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
