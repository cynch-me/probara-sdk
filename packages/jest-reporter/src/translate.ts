/**
 * One Jest attempt as a `@probara/core` result, keyed like `probara import junit` keys the output
 * of jest-junit with its default templates.
 */
import { relative, sep } from 'node:path';
import {
  emptyMetadata,
  extractTitlePathCaseIds,
  linkedCaseIds,
  metadataResultFields,
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
}

/** How the JUnit import splits a jest-junit name into the segments of a key. */
const JUNIT_SEPARATOR = ' › ';

/**
 * jest-junit's name of a test: `{classname} {title}`, the describes and the title joined by spaces
 * (its default templates), trimmed like the JUnit import trims it.
 */
function nameOf(attempt: JestAttempt): string {
  return [...attempt.ancestorTitles, attempt.title].join(' ').trim();
}

/** What Jest's status becomes: every kind of skip is skipped, and so is a `test.todo`. */
function statusOf(status: string): ResultStatus {
  if (status === 'passed' || status === 'failed') return status;
  return 'skipped';
}

/** The file of a test relative to `rootDir`, with `/` separators, as jest-junit writes it. */
function relativeFile(path: string, rootDir: string): string {
  return relative(rootDir, path).split(sep).join('/');
}

/**
 * One attempt of the test file at `path` (absolute) as a result. The identity equals the one
 * `probara import junit` reads from jest-junit: the describes and the title joined by spaces and
 * split on ` › `, the case ids of the projects it may report to removed from them and linked, and
 * the file relative to `rootDir` with `keyIncludesFile` (jest-junit's `addFileAttribute`). The suite
 * of a created case is the file, or else the first describe, like the import's.
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
    nameOf(attempt).split(JUNIT_SEPARATOR),
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

/** The same string for every attempt of one test, and another for any other test of the run. */
export function testIdOf(path: string, attempt: JestAttempt): string {
  return JSON.stringify([path, ...attempt.ancestorTitles, attempt.title]);
}
