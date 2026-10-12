/**
 * What the reporter sends for the tests of a Vitest run: the facts `tree.ts` reads off the reported
 * tasks, as `@probara/core` results. The identity follows the JUnit writer's names, and the statuses
 * and notes its rules (V-D12), so `probara import junit` on Vitest's own output gives the same keys.
 */
import {
  detailsOf,
  emptyMetadata,
  linkedCaseIds,
  metadataResultFields,
  type ChannelLine,
  type ResultStatus,
  type TestResultInput,
} from '@probara/core';
import { junitNameOf, vitestIdentity, type IdentityContext } from './identity.js';

/** One error of an attempt: its message and stack, as Vitest holds them. */
export interface ReportedError {
  message?: string;
  stack?: string;
}

/**
 * One execution of a test of a run, as the tree walk reads it off Vitest's reported task. A test that
 * was retried or repeated gives one of these per execution (see `executionsOf`).
 */
export interface ReportedTest {
  /** The file of the test: the absolute path of its module. */
  file: string;
  /** Its describes, outermost first. */
  ancestors: readonly string[];
  title: string;
  /** The state of this execution; `pending` for a test the run never got to. */
  state: 'passed' | 'failed' | 'skipped' | 'pending';
  /** Declared with `test.todo`. */
  todo: boolean;
  /** Vitest's note of a skipped test: the `ctx.skip(note)` one, or the abort of a run. */
  note?: string | undefined;
  /** Every error of this execution, in order (`expect.soft` included). */
  errors: readonly ReportedError[];
  durationMs?: number | undefined;
  /** Epoch milliseconds. */
  startedAt?: number | undefined;
  /** Zero-based repeat of this execution (`repeats`); 0 when no attempt was recorded. */
  repeat: number;
  /** Zero-based retry within its repeat; 0 when no attempt was recorded. */
  retry: number;
  /** The lines of the `probara.*` helpers called in this execution, in the order they were written. */
  lines?: readonly ChannelLine[] | undefined;
  /** The native tags of the test (Vitest 4.1 and later): the case of a report takes them when it creates it. */
  tags?: readonly string[] | undefined;
  /** The folder the files of the test's `probara.attach()` calls were copied into (V-D66); the run's when absent. */
  filesDir?: string | undefined;
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
  /** The run's folder of `probara.attach()` copies: the `attachment` lines name files inside it (V-D66). */
  filesDir?: string | undefined;
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

/**
 * The parameters that tell the executions of one test apart: `attempt` from the second attempt on,
 * and `repeat` from the second repeat on. Never part of the key.
 */
function attemptParametersOf(test: ReportedTest): Record<string, string> {
  return {
    ...(test.retry > 0 ? { attempt: String(test.retry + 1) } : {}),
    ...(test.repeat > 0 ? { repeat: String(test.repeat + 1) } : {}),
  };
}

/** The distinct items of `list`, in their first order. */
function distinct(list: readonly string[]): string[] {
  return [...new Set(list)];
}

/**
 * The result of one execution of a test of the run, or `undefined` when `probara.ignore()` left it out.
 * A passed test carries no error, as in the JUnit output. The helpers' lines of the execution say the
 * rest: the cases of `probara.id()` are linked first, then those of the title; the title, suite, comment,
 * parameters, links and steps are the helpers' own, and the case a report creates takes the tags and
 * fields of the helpers and the native tags (V-D11, V-D19).
 */
export function toResultInput(
  test: ReportedTest,
  context: TranslationContext,
): TestResultInput | undefined {
  const lines = test.lines ?? [];
  // A warning a helper recorded in this attempt is the reporter's to say, once per run.
  for (const line of lines) if (line.type === 'warning') context.warn?.(line.message);
  const details = detailsOf(lines, test.filesDir ?? context.filesDir ?? '');
  for (const problem of details.problems) context.warn?.(problem);
  if (details.metadata.ignored) return undefined;
  const { identity, ids } = vitestIdentity(
    test.file,
    junitNameOf(test.ancestors, test.title),
    context,
  );
  const notes = notesOf(test);
  const metadata = metadataResultFields(
    { ...details.metadata, tags: distinct([...details.metadata.tags, ...(test.tags ?? [])]) },
    {
      caseIds: linkedCaseIds(details.metadata.ids, ids),
      caseSteps: details.caseSteps,
      issueUrlTemplate: context.issueUrlTemplate,
      warn: context.warn,
    },
  );
  const parameters = { ...metadata.parameters, ...attemptParametersOf(test) };
  return {
    identity,
    status: statusOf(test.state),
    ...metadata,
    ...(Object.keys(parameters).length === 0 ? {} : { parameters }),
    ...(details.steps.length === 0 ? {} : { steps: details.steps }),
    ...(test.durationMs === undefined ? {} : { durationMs: test.durationMs }),
    ...(test.startedAt === undefined ? {} : { startedAt: new Date(test.startedAt) }),
    ...(test.state === 'failed' && test.errors.length > 0 ? { error: errorsOf(test.errors) } : {}),
    ...(details.attachments.length === 0 ? {} : { attachments: details.attachments }),
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
