/**
 * One Jest attempt as a `@probara/core` result, keyed like `probara import junit` keys the output
 * of jest-junit with its default templates.
 */
import {
  emptyMetadata,
  extractTitlePathCaseIds,
  linkedCaseIds,
  metadataResultFields,
  normalizeTestFile,
  type ResultStatus,
  type TestResultInput,
} from '@probara/core';
import type { AttemptDetails } from './channel-reader.js';
import type { JestAttempt } from './jest.js';

export interface TranslationContext {
  /**
   * The projects whose case ids are read from titles: the configured one, then those of
   * `projects`; none are read without them.
   */
  projectCodes: readonly string[];
  /** Start the key with the test file (jest-junit's `addFileAttribute`). */
  keyIncludesFile: boolean;
  /** The directory the file of a key is relative to: jest-junit's, the working directory. */
  rootDir: string;
  /**
   * The name of the Jest project that ran the test (its `displayName`), which jest-junit fills a
   * `{displayName}` of a title with.
   */
  displayName?: string | undefined;
}

/** How the JUnit import splits a jest-junit name into the segments of a key. */
const JUNIT_SEPARATOR = ' › ';

/** jest-junit's default `titleTemplate`. */
const JUNIT_TITLE_TEMPLATE = '{classname} {title}';

/**
 * jest-junit's name of a test with its default templates, trimmed like the JUnit import trims it:
 * `{classname} {title}`, the describes joined by spaces, then the title. jest-junit fills the tags
 * one after the other with `String.prototype.replace`, so this does too, in its order: the first
 * occurrence of each tag, `$` patterns expanded (`$$` is `$`, `$&` the tag), and a tag a describe or
 * the title holds filled too. Its `{filepath}`, `{filename}` and `{suitename}` come first, before a
 * describe or a title can hold them: they change nothing in this template.
 */
function nameOf(attempt: JestAttempt, displayName: string | undefined): string {
  return (
    JUNIT_TITLE_TEMPLATE.replace('{classname}', attempt.ancestorTitles.join(' '))
      .replace('{title}', attempt.title)
      // Without a project, jest-junit fills it with `undefined`, as `replace` writes it.
      .replace('{displayName}', String(displayName))
      .trim()
  );
}

/** What Jest's status becomes: every kind of skip is skipped, and so is a `test.todo`. */
function statusOf(status: string): ResultStatus {
  if (status === 'passed' || status === 'failed') return status;
  return 'skipped';
}

/**
 * The file of a test as its key names it: relative to `rootDir`, with `/` separators, as jest-junit
 * writes it (and normalized like every key).
 */
export function relativeFile(path: string, rootDir: string): string {
  return normalizeTestFile(path, rootDir);
}

/**
 * One attempt of the test file at `path` (absolute) as a result. The identity equals the one
 * `probara import junit` reads from jest-junit: the describes and the title joined by spaces and
 * split on ` › `, the case ids of the projects it may report to removed from them and linked, and
 * the file relative to `rootDir` with `keyIncludesFile` (jest-junit's `addFileAttribute`).
 *
 * The suite of a created case is the file, like the import's with the file attribute. Without the
 * file it is the test's own first describe, and none for a top-level test, where the import uses
 * the suite jest-junit names each file after: the first describe of the file's first test, for
 * every test of the file. Only where a case the report creates lands can differ, never its key: a
 * decision (each test in its own describe), which the docs name.
 *
 * `details` are what the `probara.*` helpers said about the attempt: the cases of `probara.id()`
 * are linked first, then those of the titles; the title, suites, comment, parameters and created
 * case they give win; their steps and files go with the result.
 */
export function toResultInput(
  path: string,
  attempt: JestAttempt,
  context: TranslationContext,
  startedAt?: number,
  details?: AttemptDetails,
): TestResultInput {
  const titled = extractTitlePathCaseIds(
    nameOf(attempt, context.displayName).split(JUNIT_SEPARATOR),
    context.projectCodes,
  );
  const describe = attempt.ancestorTitles[0]?.trim() ?? '';
  const suitePath = context.keyIncludesFile
    ? [relativeFile(path, context.rootDir)]
    : describe === ''
      ? []
      : [describe];
  const errors = attempt.failureMessages ?? [];
  const duration = attempt.duration;
  const metadata = details?.metadata ?? emptyMetadata();
  const steps = details?.steps ?? [];
  const attachments = details?.attachments ?? [];
  return {
    identity: {
      ...(context.keyIncludesFile ? { file: path } : {}),
      titlePath: titled.titlePath,
    },
    status: statusOf(attempt.status),
    suitePath,
    ...metadataResultFields(metadata, {
      caseIds: linkedCaseIds(metadata.ids, titled.ids),
      caseSteps: details?.caseSteps ?? [],
    }),
    ...(typeof duration === 'number' ? { durationMs: duration } : {}),
    ...(startedAt === undefined ? {} : { startedAt: new Date(startedAt) }),
    ...(errors.length === 0 ? {} : { error: [...errors] }),
    ...(attempt.status === 'todo' ? { notes: 'Todo' } : {}),
    ...(attachments.length === 0 ? {} : { attachments }),
    ...(steps.length === 0 ? {} : { steps }),
  };
}

/**
 * The same string for every attempt of one test, and another for any other test of the run (two
 * tests of one file with the same describes and title share it).
 */
export function testIdOf(
  path: string,
  attempt: Pick<JestAttempt, 'ancestorTitles' | 'title'>,
): string {
  return JSON.stringify([path, ...attempt.ancestorTitles, attempt.title]);
}
