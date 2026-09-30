/** One Playwright attempt as a `@probara/core` result, keyed like the CLI's Playwright JUnit import. */
import type { TestCase, TestResult } from '@playwright/test/reporter';
import {
  extractTitlePathCaseIds,
  parseCaseIdList,
  type AttachmentInput,
  type ResultStatus,
  type TestError,
  type TestResultInput,
} from '@probara/core';

export interface TranslationContext {
  /** The project whose case ids are read from titles; none are read without it. */
  projectCode: string | undefined;
  /** Attach the stdout and stderr of each attempt as `stdout.log` and `stderr.log`. */
  captureOutput: boolean;
}

/** How the JUnit reporter joins the describes and the title, and how the JUnit import splits them. */
const JUNIT_SEPARATOR = ' › ';
/** The annotation that links a test to cases: `{ type: 'probara_case', description: 'PRB-12' }`. */
const CASE_ANNOTATION = 'probara_case';

type Annotations = TestResult['annotations'];

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
  const own = (result as Partial<Pick<TestResult, 'annotations'>>).annotations;
  return own ?? test.annotations;
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

/** Every attachment with a file or a body (screenshots, videos, traces, `testInfo.attach`...). */
function attachmentsOf(result: TestResult, context: TranslationContext): AttachmentInput[] {
  const attachments: AttachmentInput[] = result.attachments
    .filter((attachment) => attachment.path !== undefined || attachment.body !== undefined)
    .map(({ name, contentType, path, body }) => ({
      name,
      contentType,
      ...(path === undefined ? {} : { path }),
      ...(body === undefined ? {} : { body }),
    }));
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

/**
 * The result of one attempt. The identity equals the one `probara import junit` reads from the
 * Playwright JUnit reporter, so switching between them keeps every case linked: the file suite
 * title (the file relative to Playwright's `rootDir`), the describes and the title split like the
 * JUnit name, and `project` only for a named project. Ids of the configured project are removed
 * from the titles and linked, after the `probara_case` annotations.
 */
export function toResultInput(
  test: TestCase,
  result: TestResult,
  context: TranslationContext,
): TestResultInput {
  // ['', project, file, ...describes, title], the path the JUnit reporter writes.
  const [, projectTitle, fileTitle, ...titles] = test.titlePath();
  const project = nonBlank(projectTitle);
  const file = nonBlank(fileTitle);
  const titled = extractTitlePathCaseIds(
    titles.join(JUNIT_SEPARATOR).split(JUNIT_SEPARATOR),
    context.projectCode,
  );
  const ids = [
    ...annotationsOf(test, result)
      .filter((annotation) => annotation.type === CASE_ANNOTATION)
      .flatMap((annotation) => parseCaseIdList(annotation.description ?? '')),
    ...titled.ids,
  ].filter((id, index, all) => all.indexOf(id) === index);
  const errors = errorsOf(result);
  const attachments = attachmentsOf(result, context);

  return {
    identity: {
      ...(file === undefined ? {} : { file }),
      titlePath: titled.titlePath,
      ...(project === undefined ? {} : { parameters: { project } }),
    },
    status: statusOf(test, result),
    ...(ids.length === 1 ? { caseDisplayId: ids[0] } : {}),
    ...(ids.length > 1 ? { caseDisplayIds: ids } : {}),
    durationMs: result.duration,
    startedAt: result.startTime,
    ...(errors.length === 0 ? {} : { error: errors }),
    ...(attachments.length === 0 ? {} : { attachments }),
  };
}
