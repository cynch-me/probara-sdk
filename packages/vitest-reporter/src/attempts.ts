/**
 * The attempts of a test: each execution Vitest runs for it (a retry, a repeat). The setup file
 * records them in `task.meta.probara.attempts` as they start and end; the reporter reads them back
 * once the run ended. Pure: no Vitest import, so the worker side and the reporter share it, and its
 * unit tests need no run.
 */
import type { ChannelLine } from '@probara/core';

/** An error of an attempt, as the report keeps it: its message and its stack, when they are strings. */
export interface AttemptError {
  message?: string;
  stack?: string;
}

/**
 * The file of an annotate call, `ctx.annotate(message, { path | body })`, as Vitest holds it on the test. A
 * path is the copy Vitest made in its attachments folder; a body is a string, or base64 text of bytes.
 */
export interface AnnotatedFile {
  /** The annotation's message: the name of the file in Probara. */
  name: string;
  path?: string | undefined;
  body?: string | undefined;
  /** How `body` is encoded, as Vitest labels it: `base64` or `utf-8`; not labelled on Vitest 3. */
  bodyEncoding?: string | undefined;
  contentType?: string | undefined;
}

/** An annotation of a test, as the reporter reads it: its message, and the file it names, if any. */
export interface UserAnnotation {
  message: string;
  file?: Omit<AnnotatedFile, 'name'> | undefined;
}

/** One execution of a test, as the setup file records it. */
export interface RecordedAttempt {
  /** Zero-based repeat (Vitest's `repeats`). */
  repeat: number;
  /** Zero-based retry within its repeat: the attempts of each repeat restart at 0. */
  retry: number;
  /** Epoch milliseconds when it started. */
  startedAt: number;
  /** `performance.now()` when it started: its duration is measured from it. */
  startedMs: number;
  /** Milliseconds from its start to the end of its `afterEach` hooks. */
  durationMs?: number;
  /** Where its errors start among the errors of the test's result. */
  errorsFrom: number;
  /** Its errors, copied once the next attempt starts: Vitest has settled them by then. */
  errors?: AttemptError[];
  /** The lines of the `probara.*` helpers called in this attempt, in the order they were written. */
  lines?: ChannelLine[];
  /**
   * How many annotations the test had when this attempt started (V-D68). Vitest keeps every try's annotations
   * on the test, so the annotations of an attempt run from its own count to the next attempt's.
   */
  annotations?: number;
}

/** The try of a test: its repeat, and its retry count as Vitest's result holds it at the time. */
export interface TryRef {
  repeat: number;
  retry: number;
}

/** What the setup file and the helpers keep under `task.meta.probara`. */
export interface ProbaraTaskMeta {
  attempts?: RecordedAttempt[];
  /** The lines of the helpers of a test whose attempts are not recorded (the setup file is not active). */
  lines?: ChannelLine[];
  /** The try the `lines` above were written in: a new try starts its own list (V-D71). */
  linesTry?: TryRef;
  /**
   * The folder the attachments of this test were copied into, as the run that ran it provided it (V-D66). A
   * blob carries it, so `--merge-reports` reads the copies where the shard wrote them.
   */
  filesDir?: string;
}

declare module 'vitest' {
  interface TaskMeta {
    /** Written by the reporter's setup file: what the reporter needs of each attempt (V-D10). */
    probara?: ProbaraTaskMeta;
  }
}

/** What an attempt reads of its test's result: the repeat it runs in, and the errors so far. */
export interface AttemptResult {
  repeatCount?: number | undefined;
  errors?: readonly { message?: unknown; stack?: unknown }[] | undefined;
}

/** The clocks of an attempt: the wall clock for its start, the monotonic one for its duration. */
export interface AttemptClock {
  epochMs: number;
  perfMs: number;
}

/** The errors from `from` on, as the report keeps them: the message and the stack only. */
function copyErrors(errors: AttemptResult['errors'], from: number): AttemptError[] {
  return (errors ?? []).slice(from).map(({ message, stack }) => ({
    ...(typeof message === 'string' ? { message } : {}),
    ...(typeof stack === 'string' ? { stack } : {}),
  }));
}

/**
 * Opens the attempt that starts now. The attempt before it is closed first: its errors are copied,
 * because they are final by the time the next attempt starts (a retry, or the next repeat).
 */
export function beginAttempt(
  meta: ProbaraTaskMeta,
  result: AttemptResult,
  clock: AttemptClock,
  annotations?: number,
): void {
  const attempts = meta.attempts ?? [];
  const previous = attempts.at(-1);
  if (previous !== undefined && previous.errors === undefined) {
    previous.errors = copyErrors(result.errors, previous.errorsFrom);
  }
  const repeat = result.repeatCount ?? 0;
  attempts.push({
    repeat,
    retry: attempts.filter((attempt) => attempt.repeat === repeat).length,
    startedAt: clock.epochMs,
    startedMs: clock.perfMs,
    errorsFrom: result.errors?.length ?? 0,
    ...(annotations === undefined ? {} : { annotations }),
  });
  meta.attempts = attempts;
}

/** Measures the attempt that is running from its start to now (the end of its `afterEach` hooks). */
export function endAttempt(meta: ProbaraTaskMeta, clock: { perfMs: number }): void {
  const current = meta.attempts?.at(-1);
  if (current !== undefined && current.durationMs === undefined) {
    current.durationMs = clock.perfMs - current.startedMs;
  }
}

/** A test as Vitest reports it once it ended, read off its result. */
export interface EndedTest {
  /** The state of its result; `pending` for a test the run never got to. */
  state: 'passed' | 'failed' | 'skipped' | 'pending';
  /** The note of a skipped test: `ctx.skip(note)`, or the abort of the run. */
  note?: string | undefined;
  /** Every error of its result, in order: those of the earlier attempts included. */
  errors: readonly AttemptError[];
  durationMs?: number | undefined;
  /** Epoch milliseconds. */
  startedAt?: number | undefined;
  /** How many retries Vitest ran, and how many repeats (`repeatCount` is the last repeat's index). */
  retryCount: number;
  repeatCount: number;
  /** The helpers' lines when no attempt is recorded, and the try they were written in. */
  lines?: readonly ChannelLine[] | undefined;
  linesTry?: TryRef | undefined;
  /** Every annotation of the test, in the order it was made: those of every try included. */
  annotations?: readonly UserAnnotation[] | undefined;
}

/** One execution of a test, as the report sends it: a result of its own. */
export interface Execution {
  repeat: number;
  retry: number;
  state: EndedTest['state'];
  note?: string | undefined;
  errors: readonly AttemptError[];
  durationMs?: number | undefined;
  startedAt?: number | undefined;
  /** The helpers' lines of this execution (see `RecordedAttempt.lines`). */
  lines?: readonly ChannelLine[];
  /** The files of the annotate calls made in this execution (V-D68). */
  files: readonly AnnotatedFile[];
}

/** The executions of a test, in the order they ran. */
export interface Executions {
  executions: Execution[];
  /** Vitest retried or repeated the test, but no attempt of it was recorded (see `executionsOf`). */
  unrecorded: boolean;
  /** The files of the annotate calls left out, since their attempts cannot be told apart (V-D68). */
  dropped: number;
}

/**
 * The try a result is in: its repeat and its retry count, zero where Vitest gives none. Vitest counts the
 * retries of a test across its repeats, so the pair identifies one try (V-D71).
 */
export function tryOf(result: {
  repeatCount?: number | undefined;
  retryCount?: number | undefined;
}): TryRef {
  return { repeat: result.repeatCount ?? 0, retry: result.retryCount ?? 0 };
}

/** Whether lines written in the try `written` belong to the try `now` is in. */
export function sameTry(written: TryRef | undefined, now: TryRef): boolean {
  return written !== undefined && written.repeat === now.repeat && written.retry === now.retry;
}

/**
 * The executions of a test. Recorded attempts give one execution each: an attempt before the last
 * one is failed when it ended with errors and passed otherwise, and the last one keeps its own
 * outcome, the state of its result only when that is skipped or pending. A repeat that passed after a
 * failed one is passed, though the test as a whole failed. Without recorded attempts the test is one
 * execution, the result it ended with, and `unrecorded` tells when Vitest retried or repeated it.
 */
/** The files of annotations, each named by its message, in the order they were made. */
function filesOf(annotations: readonly UserAnnotation[]): AnnotatedFile[] {
  return annotations.flatMap(({ message, file }) =>
    file === undefined ? [] : [{ name: message, ...file }],
  );
}

/** The files of the annotations from `from` to `to`; none when either bound is unknown (V-D68). */
function filesBetween(
  annotations: readonly UserAnnotation[],
  from: number | undefined,
  to: number | undefined,
): AnnotatedFile[] {
  return from === undefined || to === undefined ? [] : filesOf(annotations.slice(from, to));
}

export function executionsOf(
  recorded: readonly RecordedAttempt[] | undefined,
  ended: EndedTest,
): Executions {
  const annotations = ended.annotations ?? [];
  if (recorded === undefined || recorded.length === 0) {
    // The lines of an unrecorded test are the final execution's only when they were written in its final try:
    // a failed earlier try's steps are not in a passing final one (V-D71).
    const lines = sameTry(ended.linesTry, tryOf(ended)) ? ended.lines : undefined;
    const unrecorded = ended.retryCount > 0 || ended.repeatCount > 0;
    // Vitest keeps one annotation list for every try of a test: a test that was retried or repeated without
    // recorded attempts cannot tell its files apart, so they are left out and counted (V-D68).
    const files = filesOf(annotations);
    return {
      executions: [
        {
          repeat: 0,
          retry: 0,
          state: ended.state,
          ...(ended.note === undefined ? {} : { note: ended.note }),
          errors: ended.errors,
          ...(ended.durationMs === undefined ? {} : { durationMs: ended.durationMs }),
          ...(ended.startedAt === undefined ? {} : { startedAt: ended.startedAt }),
          ...(lines === undefined ? {} : { lines }),
          files: unrecorded ? [] : files,
        },
      ],
      unrecorded,
      dropped: unrecorded ? files.length : 0,
    };
  }
  const last = recorded.length - 1;
  // One recorded attempt is the whole test: its start and duration are Vitest's own, as they were before
  // attempts were recorded. The setup file's clocks only split several attempts (V-D10).
  const clocksOfAttempts = recorded.length > 1;
  const executions = recorded.map((attempt, index): Execution => {
    const { repeat, retry } = attempt;
    const startedAt = clocksOfAttempts ? attempt.startedAt : ended.startedAt;
    const durationMs = clocksOfAttempts
      ? (attempt.durationMs ?? (index === last ? ended.durationMs : undefined))
      : ended.durationMs;
    // An attempt's annotations run from its own count to the next attempt's; the last one runs to the end.
    const files = filesBetween(
      annotations,
      attempt.annotations,
      index === last ? annotations.length : recorded[index + 1]?.annotations,
    );
    if (index < last) {
      const errors = attempt.errors ?? [];
      return {
        repeat,
        retry,
        state: errors.length > 0 ? 'failed' : 'passed',
        errors,
        ...(durationMs === undefined ? {} : { durationMs }),
        startedAt,
        ...(attempt.lines === undefined ? {} : { lines: attempt.lines }),
        files,
      };
    }
    const errors = attempt.errors ?? ended.errors.slice(attempt.errorsFrom);
    const kept = ended.state === 'skipped' || ended.state === 'pending';
    const state = kept ? ended.state : errors.length > 0 ? 'failed' : 'passed';
    return {
      repeat,
      retry,
      state,
      ...(kept && ended.note !== undefined ? { note: ended.note } : {}),
      errors,
      ...(durationMs === undefined ? {} : { durationMs }),
      startedAt,
      ...(attempt.lines === undefined ? {} : { lines: attempt.lines }),
      files,
    };
  });
  return { executions, unrecorded: false, dropped: 0 };
}
