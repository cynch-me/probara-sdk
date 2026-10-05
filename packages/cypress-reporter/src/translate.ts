/**
 * One Cypress attempt as a `@probara/core` result, keyed like `probara import junit` keys the output
 * of cypress-junit with its default templates.
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
import type { AttemptDetails } from '@probara/core';
import { cypressTestIdentity, type CypressTestNames, type IdentityContext } from './identity.js';

export interface TranslationContext extends IdentityContext {
  /** What `probara.issue()` ids become (`issueUrlTemplate`); without it they are dropped. */
  issueUrlTemplate?: string | undefined;
  /** The browser Cypress runs (`electron`), sent as a parameter of every result. */
  browser?: string | undefined;
  /** Send that browser as a parameter at all (`browserAsParameter`). */
  browserAsParameter?: boolean | undefined;
  /** Told why something the helpers said is not sent (issues without a template). */
  warn?: ((message: string) => void) | undefined;
}

/**
 * The Mocha event one attempt ended with, which is what its status is: `pass` and `fail` as
 * themselves, `retry` as a failure of its own (the attempt Cypress is about to run again), and
 * `pending` (`it.skip`, `this.skip()`) as skipped.
 */
export type CypressOutcome = 'pass' | 'fail' | 'retry' | 'pending';

/** One attempt, as the reporter holds it while a spec runs. */
export interface CypressAttempt extends CypressTestNames {
  /** The Mocha event the attempt ended with. */
  outcome: CypressOutcome;
  /** Which attempt of the test this is, 1 for the first: sent as a parameter from the second on. */
  attempt?: number | undefined;
  /** Milliseconds the attempt took, when the framework reports its own duration. */
  durationMs?: number | undefined;
  /** The error it failed with: the runnable's own, or the one the event carried. */
  error?: Error | undefined;
}

/** What a Mocha outcome becomes in Probara. */
export function statusOf(outcome: CypressOutcome): ResultStatus {
  if (outcome === 'pass') return 'passed';
  if (outcome === 'pending') return 'skipped';
  return 'failed';
}

/**
 * The spec file as its key names it: relative to `rootDir`, with `/` separators, as cypress-junit
 * writes it in the `file` attribute of the root suite (and normalized like every key).
 */
export function relativeFile(path: string, rootDir: string): string {
  return normalizeTestFile(path, rootDir);
}

/**
 * One attempt of the test `test` of the spec at `path` as a result. The identity equals the one
 * `probara import junit` reads from cypress-junit: the spec file relative to `rootDir` with
 * `keyIncludesFile`, and the full title (the describes and the `it` title joined by spaces) as a
 * single title segment, with the case ids of the projects it may report to taken out of it.
 *
 * The suite of a created case is the spec file and the describes: the one difference from the
 * import, which cannot rebuild a suite path from a single title segment (and puts the file's
 * first describe there). Only where a case the report creates lands can differ, never its key; the
 * reporter's docs name it in their comparison with `probara import junit`.
 *
 * `details` are what the `probara.*` helpers said about the attempt (through `cy.task`), and the
 * files the plugin picked up for it (its screenshot, the spec's video): the cases of
 * `probara.id()` are linked first, then those of the title; the title, suites, comment, parameters
 * and created case they give win; their steps, files and links (issues with `issueUrlTemplate`) go
 * with the result.
 */
export function toResultInput(
  path: string,
  test: CypressAttempt,
  context: TranslationContext,
  startedAt?: number,
  details?: AttemptDetails,
): TestResultInput {
  const { identity, ids } = cypressTestIdentity(path, test, context);
  // The suites of a created case are its describes, as a case id there links the case instead of
  // naming it.
  const describes = extractTitlePathCaseIds(test.suiteTitles, context.projectCodes).titlePath;
  const suitePath = context.keyIncludesFile
    ? [relativeFile(path, context.rootDir), ...describes]
    : [...describes];
  const metadata = details?.metadata ?? emptyMetadata();
  const steps = details?.steps ?? [];
  const attachments = details?.attachments ?? [];
  const fields = metadataResultFields(metadata, {
    caseIds: linkedCaseIds(metadata.ids, ids),
    caseSteps: details?.caseSteps ?? [],
    issueUrlTemplate: context.issueUrlTemplate,
    warn: context.warn,
  });
  const browser =
    context.browserAsParameter === true && typeof context.browser === 'string'
      ? { browser: context.browser }
      : {};
  // The attempt number shows which retry Probara holds; a first attempt says it with nothing.
  const attempt = typeof test.attempt === 'number' && test.attempt > 1
    ? { attempt: String(test.attempt) }
    : {};
  const parameters = { ...browser, ...attempt, ...fields.parameters };
  return {
    identity,
    status: statusOf(test.outcome),
    suitePath,
    ...fields,
    ...(Object.keys(parameters).length === 0 ? {} : { parameters }),
    ...(typeof test.durationMs === 'number' ? { durationMs: test.durationMs } : {}),
    ...(startedAt === undefined ? {} : { startedAt: new Date(startedAt) }),
    ...(test.error === undefined ? {} : { error: [errorText(test.error)] }),
    ...(attachments.length === 0 ? {} : { attachments }),
    ...(steps.length === 0 ? {} : { steps }),
  };
}

/** The error of a failed attempt, with its stack when it has one: what core writes into the notes. */
function errorText(error: Error): string {
  const { message, stack } = error;
  if (typeof stack !== 'string' || stack === '') return message;
  return stack.includes(message) ? stack : [message, stack].join('\n');
}

/**
 * The same string for every attempt of one test of one spec, and another for any other test (two
 * tests of one spec with the same describes and title share it). It counts as one test for the
 * `Sending N results of M tests` line, and keys what the `probara.*` helpers said about it.
 */
export function testIdOf(path: string, test: CypressTestNames): string {
  return JSON.stringify([path, ...test.suiteTitles, test.title]);
}