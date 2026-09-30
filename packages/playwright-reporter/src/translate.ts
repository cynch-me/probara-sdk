/** One Playwright attempt as a `@probara/core` result, keyed like the CLI's Playwright JUnit import. */
import { basename, extname } from 'node:path';
import type { TestCase, TestResult } from '@playwright/test/reporter';
import {
  extractTitlePathCaseIds,
  hasFileExtension,
  linkedCaseIds,
  metadataResultFields,
  type AttachmentInput,
  type ResultStatus,
  type TestError,
  type TestResultInput,
} from '@probara/core';
import { CASE_ANNOTATION, isMetadataAttachment, readMetadata } from './metadata.js';
import { translateSteps } from './steps.js';

export interface TranslationContext {
  /**
   * The projects whose case ids are read from titles: the configured one, then those of
   * `projects`; none are read without them.
   */
  projectCodes: readonly string[];
  /** Attach the stdout and stderr of each attempt as `stdout.log` and `stderr.log`. */
  captureOutput: boolean;
}

/** How the JUnit reporter joins the describes and the title, and how the JUnit import splits them. */
const JUNIT_SEPARATOR = ' › ';

type Annotations = TestCase['annotations'];

function nonBlank(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/**
 * What the attempt did, as Playwright judges it: a `test.fail()` test that fails as expected
 * passes, one that passes fails; an interrupted attempt fails; a skipped one stays skipped.
 */
function statusOf(test: TestCase, result: TestResult): ResultStatus {
  if (result.status === 'interrupted') return 'failed';
  if (result.status === 'skipped') return 'skipped';
  return result.status === test.expectedStatus ? 'passed' : 'failed';
}

/** The annotations of this attempt; the test's before Playwright 1.52 gave attempts their own. */
function annotationsOf(test: TestCase, result: TestResult): Annotations {
  const own = (result as { annotations?: Annotations }).annotations;
  return own ?? test.annotations;
}

/**
 * `Skipped: <reason>` for a skipped attempt, like the JUnit import writes it: the reason of its
 * `test.skip(condition, reason)` or `test.fixme(condition, reason)`.
 */
function skipNoteOf(annotations: Annotations, status: ResultStatus): string | undefined {
  if (status !== 'skipped') return undefined;
  const reason = annotations
    .filter((annotation) => annotation.type === 'skip' || annotation.type === 'fixme')
    .map((annotation) => nonBlank(annotation.description))
    .find((description) => description !== undefined);
  return reason === undefined ? undefined : `Skipped: ${reason}`;
}

function errorsOf(result: TestResult): TestError[] {
  return result.errors.map((error) => {
    const message = error.message ?? error.value;
    return {
      ...(message === undefined ? {} : { message }),
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  });
}

/**
 * A file Playwright named after a hash: `testInfo.attach` copies a file to `<name>-<sha1>.<ext>`,
 * and merged blob reports hold every file as `<sha1>.<ext>`.
 */
const HASHED_FILE = /^(?:.+-)?[0-9a-f]{40}$/i;

/**
 * The name to store a file under when its own name is a Playwright hash: the attachment name, with
 * the extension of the file when the name has none (`screenshot.png`, `trace.zip`). Otherwise
 * `undefined`: core keeps the file's own name (`test-failed-1.png`, `trace.zip`).
 */
function fileNameOf(name: string, path: string): string | undefined {
  const file = basename(path);
  const extension = extname(file);
  const given = name.trim();
  if (given === '' || !HASHED_FILE.test(file.slice(0, file.length - extension.length))) {
    return undefined;
  }
  return hasFileExtension(given) ? given : `${given}${extension}`;
}

type PlaywrightAttachment = TestResult['attachments'][number];

/** One Playwright attachment as a file of core, named after the attachment when hashed. */
function fileOf({ name, contentType, path, body }: PlaywrightAttachment): AttachmentInput {
  const fileName = path === undefined ? undefined : fileNameOf(name, path);
  return {
    name,
    ...(fileName === undefined ? {} : { fileName }),
    contentType,
    ...(path === undefined ? {} : { path }),
    ...(body === undefined ? {} : { body }),
  };
}

/**
 * Every attachment with a file or a body (screenshots, videos, traces, `testInfo.attach`...), but
 * those a step took (`claimed`).
 */
function attachmentsOf(
  result: TestResult,
  context: TranslationContext,
  claimed: ReadonlySet<object>,
): AttachmentInput[] {
  const attachments: AttachmentInput[] = result.attachments
    .filter((attachment) => attachment.path !== undefined || attachment.body !== undefined)
    // The metadata of probara.* is read, never uploaded.
    .filter((attachment) => !isMetadataAttachment(attachment))
    .filter((attachment) => !claimed.has(attachment))
    .map(fileOf);
  if (context.captureOutput) {
    for (const [name, chunks] of [
      ['stdout.log', result.stdout],
      ['stderr.log', result.stderr],
    ] as const) {
      const body = Buffer.concat(
        chunks.map((chunk) => (typeof chunk === 'string' ? Buffer.from(chunk) : chunk)),
      );
      if (body.length > 0) attachments.push({ name, contentType: 'text/plain', body });
    }
  }
  return attachments;
}

/** One attempt, translated. */
export interface Attempt {
  input: TestResultInput;
  /** `probara.ignore()` was called: the attempt is not reported. */
  ignored: boolean;
  /** Malformed metadata that was left out. */
  problems: string[];
}

/**
 * One attempt as a result, with the metadata of `probara.*`. The identity equals the one
 * `probara import junit` reads from the Playwright JUnit reporter, so switching between them keeps
 * every case linked: the file suite title (the file relative to Playwright's `rootDir`), the
 * describes and the title split like the JUnit name, and `project` only for a named project. The
 * linked cases are those of every `probara_case` annotation (`probara.id()` adds one), then the ids
 * of the projects it may report to in the titles, which are removed from them; each once.
 */
export function toAttempt(
  test: TestCase,
  result: TestResult,
  context: TranslationContext,
): Attempt {
  // ['', project, file, ...describes, title], the path the JUnit reporter writes.
  const [, projectTitle, fileTitle, ...titles] = test.titlePath();
  const project = nonBlank(projectTitle);
  const file = nonBlank(fileTitle);
  const titled = extractTitlePathCaseIds(
    titles.join(JUNIT_SEPARATOR).split(JUNIT_SEPARATOR),
    context.projectCodes,
  );
  const annotations = annotationsOf(test, result);
  const status = statusOf(test, result);
  const ids = linkedCaseIds(
    annotations
      .filter((annotation) => annotation.type === CASE_ANNOTATION)
      .map((annotation) => annotation.description ?? ''),
    titled.ids,
  );
  const errors = errorsOf(result);
  const notes = skipNoteOf(annotations, status);
  const { metadata, problems } = readMetadata(result.attachments);
  const { steps, claimed, caseSteps } = translateSteps(result.steps, metadata.steps, fileOf);
  const attachments = attachmentsOf(result, context, claimed);

  const input: TestResultInput = {
    identity: {
      ...(file === undefined ? {} : { file }),
      titlePath: titled.titlePath,
      ...(project === undefined ? {} : { parameters: { project } }),
    },
    status,
    ...metadataResultFields(metadata, { caseIds: ids, caseSteps }),
    durationMs: result.duration,
    startedAt: result.startTime,
    ...(errors.length === 0 ? {} : { error: errors }),
    ...(notes === undefined ? {} : { notes }),
    ...(attachments.length === 0 ? {} : { attachments }),
    ...(steps.length === 0 ? {} : { steps }),
  };
  return { input, ignored: metadata.ignored, problems };
}

/** The result of one attempt (see {@link toAttempt}). */
export function toResultInput(
  test: TestCase,
  result: TestResult,
  context: TranslationContext,
): TestResultInput {
  return toAttempt(test, result, context).input;
}
