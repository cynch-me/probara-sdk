/**
 * One Jest attempt as a `@probara/core` result, keyed like `probara import junit` keys the output
 * of jest-junit with its default templates.
 */
import {
  emptyMetadata,
  linkedCaseIds,
  metadataResultFields,
  normalizeTestFile,
  type ResultStatus,
  type TestResultInput,
} from '@probara/core';
import type { AttemptDetails } from './channel-reader.js';
import { jestTestIdentity, type IdentityContext } from './identity.js';
import type { JestAttempt } from './jest.js';

export interface TranslationContext extends IdentityContext {
  /** What `probara.issue()` ids become (`issueUrlTemplate`); without it they are dropped. */
  issueUrlTemplate?: string | undefined;
  /** Told why something the helpers said is not sent (issues without a template). */
  warn?: ((message: string) => void) | undefined;
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
 * case they give win; their steps, files and links (issues with `issueUrlTemplate`) go with the
 * result.
 */
export function toResultInput(
  path: string,
  attempt: JestAttempt,
  context: TranslationContext,
  startedAt?: number,
  details?: AttemptDetails,
): TestResultInput {
  const { identity, ids } = jestTestIdentity(path, attempt, context);
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
    identity,
    status: statusOf(attempt.status),
    suitePath,
    ...metadataResultFields(metadata, {
      caseIds: linkedCaseIds(metadata.ids, ids),
      caseSteps: details?.caseSteps ?? [],
      issueUrlTemplate: context.issueUrlTemplate,
      warn: context.warn,
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
