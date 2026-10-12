/**
 * What the reporter sends for the tests of a Vitest run: the facts `tree.ts` reads off the reported
 * tasks, as `@probara/core` results. The identity follows the JUnit writer's names, and the statuses
 * and notes its rules (V-D12), so `probara import junit` on Vitest's own output gives the same keys.
 */
import {
  detailsOf,
  emptyMetadata,
  hasFileExtension,
  linkedCaseIds,
  metadataResultFields,
  type AttachmentInput,
  type ChannelLine,
  type ResultStatus,
  type TestResultInput,
} from '@probara/core';
import { extname } from 'node:path';
import type { AnnotatedFile, ConsoleEntry } from './attempts.js';
import { outputAttachmentsOf } from './console-output.js';
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
  /** The files of the test's annotate calls in this execution, each named by its message (V-D68). */
  files?: readonly AnnotatedFile[] | undefined;
  /** The console output this execution wrote, attached as `stdout.log` and `stderr.log` (V-D9). */
  logs?: readonly ConsoleEntry[] | undefined;
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

/** A content type of text: a body of such a type is text. */
const TEXT_TYPE = /^text\/|\/(?:[\w.-]+\+)?(?:json|xml|yaml|javascript|csv|x-ndjson|x-yaml)$/;

/** Base64 text, padded, as Node writes it: the form in which Vitest 3 keeps the bytes of a body. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * What Vitest 3's base64 encoder writes for a byte it cannot encode: the sextets of `+` and `/` are missing from its
 * alphabet, so each one becomes this word. The word is base64-shaped, so the bytes it stands for are not recoverable.
 */
const VITEST_3_LOST_SEXTET = 'undefined';

/**
 * The bytes of an annotate body and their content type (V-D69, R-V6). A `bodyEncoding` label decides: `base64`
 * is decoded, and `utf-8` (Vitest 4.1.3 and later label every body) is text. With no label (Vitest 3), a string is
 * the text the caller gave, except that the bytes of a Uint8Array arrive as base64 text. Under a binary content
 * type, base64 text is decoded when it is exact, and left out (`undefined`) when Vitest 3 lost some of its bytes;
 * anything else is text, typed as text. Text that cannot be told from bytes is never decoded.
 */
function bodyOf(
  body: string,
  file: AnnotatedFile,
): { bytes: Buffer; contentType?: string | undefined } | undefined {
  const { bodyEncoding, contentType } = file;
  if (bodyEncoding === 'base64') return { bytes: Buffer.from(body, 'base64'), contentType };
  if (bodyEncoding !== undefined) {
    return { bytes: Buffer.from(body, 'utf8'), contentType: contentType ?? 'text/plain' };
  }
  const binary = contentType !== undefined && !TEXT_TYPE.test(contentType);
  if (binary && body !== '' && BASE64.test(body)) {
    if (body.includes(VITEST_3_LOST_SEXTET)) return undefined;
    return { bytes: Buffer.from(body, 'base64'), contentType };
  }
  return {
    bytes: Buffer.from(body, 'utf8'),
    contentType: binary || contentType === undefined ? 'text/plain' : contentType,
  };
}

/**
 * The file of an annotate call as core takes it: a path (the copy Vitest made, named by the message, with the
 * extension of the path), or a body, as `bodyOf` reads it. A body whose bytes Vitest 3 lost is left out with a
 * warning, never sent corrupted. Nothing else is sent.
 */
function annotatedFileOf(
  file: AnnotatedFile,
  context: TranslationContext,
): AttachmentInput | undefined {
  const { name } = file;
  if (file.path !== undefined) {
    const fileName = hasFileExtension(name) ? name : `${name}${extname(file.path)}`;
    return {
      name,
      fileName,
      path: file.path,
      ...(file.contentType === undefined ? {} : { contentType: file.contentType }),
    };
  }
  if (file.body === undefined) return undefined;
  const decoded = bodyOf(file.body, file);
  if (decoded === undefined) {
    context.warn?.(
      `Skipped an annotate file "${name}": Vitest 3 loses some bytes of a binary body, so it cannot be sent intact; attach the file with a path instead`,
    );
    return undefined;
  }
  const { bytes, contentType } = decoded;
  return {
    name,
    body: bytes,
    ...(contentType === undefined ? {} : { contentType }),
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
  const annotated = (test.files ?? []).flatMap((file) => {
    const input = annotatedFileOf(file, context);
    return input === undefined ? [] : [input];
  });
  const attachments = [
    ...details.attachments,
    ...annotated,
    ...outputAttachmentsOf(test.logs ?? []),
  ];
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
    ...(attachments.length === 0 ? {} : { attachments }),
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
