/**
 * What the reporter sends for the tests of a Vitest run: the facts `tree.ts` reads off the reported
 * tasks, as `@probara/core` results. The identity follows the JUnit writer's names, and the statuses
 * and notes its rules (V-D12), so `probara import junit` on Vitest's own output gives the same keys.
 */
import {
  emptyMetadata,
  linkedCaseIds,
  metadataResultFields,
  type ResultStatus,
  type TestResultInput,
} from '@probara/core';
import { junitNameOf, vitestIdentity, type IdentityContext } from './identity.js';

/** One error of an attempt: its message and stack, as Vitest holds them. */
export interface ReportedError {
  message?: string;
  stack?: string;
}

/** A test of a run, as the tree walk reads it off Vitest's reported task. */
export interface ReportedTest {
  /** The file of the test: the absolute path of its module. */
  file: string;
  /** Its describes, outermost first. */
  ancestors: readonly string[];
  title: string;
  /** Vitest's state of its result; `pending` for a test the run never got to. */
  state: 'passed' | 'failed' | 'skipped' | 'pending';
  /** Declared with `test.todo`. */
  todo: boolean;
  /** Vitest's note of a skipped test: the `ctx.skip(note)` one, or the abort of a run. */
  note?: string | undefined;
  /** Every error of the attempt, in order (`expect.soft` included). */
  errors: readonly ReportedError[];
  durationMs?: number | undefined;
  /** Epoch milliseconds. */
  startedAt?: number | undefined;
}

/**
 * A failure the JUnit writer reports as a test: a suite whose `beforeAll` or `afterAll` hook threw,
 * or a file that failed to import.
 */
export interface ReportedFailure {
  file: string;
  /** The name the JUnit writer gives it: the suite's own name, or the file's. */
  name: string;
  errors: readonly ReportedError[];
}

export interface TranslationContext extends IdentityContext {
  /** What `probara.issue()` ids become (`issueUrlTemplate`); without it they are dropped. */
  issueUrlTemplate?: string | undefined;
  /** Told why something is not sent. */
  warn?: ((message: string) => void) | undefined;
}

/** The note of a test the run was interrupted before it ran (`--bail`, Ctrl-C). */
const NOT_RUN_NOTE = 'Not run: the test run was interrupted';

/** The note Vitest gives a test it skipped because the run was aborted: kept as it is. */
const ABORT_NOTE = 'The test run was aborted by the user.';

/** Passed and failed stay so; every kind of skip, a todo and an unfinished test are skipped. */
function statusOf(state: ReportedTest['state']): ResultStatus {
  return state === 'passed' || state === 'failed' ? state : 'skipped';
}

/** The note of a result: why it did not run, or what `ctx.skip` said. */
function notesOf(test: ReportedTest): string | undefined {
  if (test.state === 'pending') return NOT_RUN_NOTE;
  if (test.todo) return 'Todo';
  const note = test.note ?? '';
  if (test.state !== 'skipped' || note === '') return undefined;
  return note === ABORT_NOTE ? note : `Skipped: ${note}`;
}

/** The errors as core takes them: only the parts that exist. */
function errorsOf(errors: readonly ReportedError[]): { message?: string; stack?: string }[] {
  return errors.map(({ message, stack }) => ({
    ...(message === undefined ? {} : { message }),
    ...(stack === undefined ? {} : { stack }),
  }));
}

/** The result of one test of the run. A passed test carries no error, as in the JUnit output. */
export function toResultInput(test: ReportedTest, context: TranslationContext): TestResultInput {
  const { identity, ids } = vitestIdentity(
    test.file,
    junitNameOf(test.ancestors, test.title),
    context,
  );
  const notes = notesOf(test);
  return {
    identity,
    status: statusOf(test.state),
    ...metadataResultFields(emptyMetadata(), {
      caseIds: linkedCaseIds([], ids),
      issueUrlTemplate: context.issueUrlTemplate,
      warn: context.warn,
    }),
    ...(test.durationMs === undefined ? {} : { durationMs: test.durationMs }),
    ...(test.startedAt === undefined ? {} : { startedAt: new Date(test.startedAt) }),
    ...(test.state === 'failed' && test.errors.length > 0 ? { error: errorsOf(test.errors) } : {}),
    ...(notes === undefined ? {} : { notes }),
  };
}

/** The failed result of a suite's hook or of a file that failed to import, named as the JUnit writer names it. */
export function failureToResultInput(
  failure: ReportedFailure,
  context: TranslationContext,
): TestResultInput {
  const { identity, ids } = vitestIdentity(failure.file, failure.name, context);
  return {
    identity,
    status: 'failed',
    ...metadataResultFields(emptyMetadata(), {
      caseIds: linkedCaseIds([], ids),
      issueUrlTemplate: context.issueUrlTemplate,
      warn: context.warn,
    }),
    ...(failure.errors.length === 0 ? {} : { error: errorsOf(failure.errors) }),
  };
}
