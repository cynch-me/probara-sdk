/**
 * The attempts of a test: each execution Vitest runs for it (a retry, a repeat). The setup file
 * records them in `task.meta.probara.attempts` as they start and end; the reporter reads them back
 * once the run ended. Pure: no Vitest import, so the worker side and the reporter share it, and its
 * unit tests need no run.
 */

/** An error of an attempt, as the report keeps it: its message and its stack, when they are strings. */
export interface AttemptError {
  message?: string;
  stack?: string;
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
}

/** What the setup file keeps under `task.meta.probara`. */
export interface ProbaraTaskMeta {
  attempts?: RecordedAttempt[];
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
}

/** The executions of a test, in the order they ran. */
export interface Executions {
  executions: Execution[];
  /** Vitest retried or repeated the test, but no attempt of it was recorded (see `executionsOf`). */
  unrecorded: boolean;
}

/**
 * The executions of a test. Recorded attempts give one execution each: an attempt before the last
 * one is failed when it ended with errors and passed otherwise, and the last one keeps its own
 * outcome, the state of its result only when that is skipped or pending. A repeat that passed after a
 * failed one is passed, though the test as a whole failed. Without recorded attempts the test is one
 * execution, the result it ended with, and `unrecorded` tells when Vitest retried or repeated it.
 */
export function executionsOf(
  recorded: readonly RecordedAttempt[] | undefined,
  ended: EndedTest,
): Executions {
  if (recorded === undefined || recorded.length === 0) {
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
        },
      ],
      unrecorded: ended.retryCount > 0 || ended.repeatCount > 0,
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
    if (index < last) {
      const errors = attempt.errors ?? [];
      return {
        repeat,
        retry,
        state: errors.length > 0 ? 'failed' : 'passed',
        errors,
        ...(durationMs === undefined ? {} : { durationMs }),
        startedAt,
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
    };
  });
  return { executions, unrecorded: false };
}
