import {
  CASE_ANNOTATION,
  extractTitlePathCaseIds,
  fanOutByCase,
  parseCaseIdList,
  type AttachmentInput,
  type ResultStatus,
  type TestResultInput,
} from '@probara/core';
import { dirname, resolve } from 'node:path';
import { outputAttachments, referencedPaths, resolveAttachment } from './attachments.js';
import {
  DIALECT_MAPPINGS,
  detectDialect,
  type DialectMapping,
  type JUnitDialect,
} from './dialects.js';
import type { JUnitDocument, JUnitOutcome, JUnitSuite, JUnitTestCase } from './model.js';
import { parseJUnit } from './parse.js';

export type { JUnitDialect } from './dialects.js';

export interface JUnitToResultsOptions {
  /** The report's path, named in errors and warnings. Relative attachment paths start at its folder. */
  filePath: string;
  /** Overrides the detected dialect. */
  dialect?: JUnitDialect | undefined;
  /**
   * The Probara project codes whose ids are read from test names: the project (`PRB`), then those
   * of `--projects`. Without them, ids in test names are not parsed.
   */
  projectCodes?: readonly string[] | undefined;
  /** The status of an `<error>`: `failed` (default) or `blocked`. */
  errorStatus?: 'failed' | 'blocked' | undefined;
  /** Adds each testcase's system-out and system-err as text attachments. */
  attachOutput?: boolean | undefined;
  /** Directory relative paths are resolved against. Defaults to `process.cwd()`. */
  cwd?: string | undefined;
}

export interface JUnitConversion {
  dialect: JUnitDialect;
  /** One result per testcase and linked case, in document order. */
  results: TestResultInput[];
  warnings: string[];
}

const FAILURES: ReadonlySet<JUnitOutcome['kind']> = new Set(['failure', 'error']);
const FLAKY: ReadonlySet<JUnitOutcome['kind']> = new Set(['flakyFailure', 'flakyError']);
const RERUNS: ReadonlySet<JUnitOutcome['kind']> = new Set(['rerunFailure', 'rerunError']);

interface Context {
  mapping: DialectMapping;
  /** The whole report: an identity may need what another suite of it holds. */
  document: JUnitDocument;
  options: JUnitToResultsOptions;
  reportDir: string;
  cwd: string;
  warnings: string[];
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function firstLine(text: string | undefined): string | undefined {
  return text
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
}

/** Status, error and notes from the outcome elements. */
function outcomeOf(
  testcase: JUnitTestCase,
  context: Context,
): Partial<TestResultInput> & { status: ResultStatus } {
  const { outcomes } = testcase;
  // A `<failure>` wins over an `<error>` (such as a teardown error after a failed assertion).
  const failure =
    outcomes.find(({ kind }) => kind === 'failure') ??
    outcomes.find(({ kind }) => FAILURES.has(kind));
  if (failure !== undefined) {
    const status: ResultStatus =
      failure.kind === 'failure' ? 'failed' : (context.options.errorStatus ?? 'failed');
    const error = context.mapping.error(failure);
    const reruns = outcomes.filter(({ kind }) => RERUNS.has(kind)).length;
    return {
      status,
      ...(error === undefined ? {} : { error }),
      ...(reruns === 0 ? {} : { notes: `Failed in all ${reruns + 1} attempts.` }),
    };
  }

  const skipped = outcomes.find(({ kind }) => kind === 'skipped');
  if (skipped !== undefined) {
    const reason = context.mapping.skipReason(testcase, skipped);
    return { status: 'skipped', ...(reason === undefined ? {} : { notes: `Skipped: ${reason}` }) };
  }

  const flaky = outcomes.filter(({ kind }) => FLAKY.has(kind));
  const [first] = flaky;
  if (first === undefined) return { status: 'passed' };
  const message = first.message?.trim() || firstLine(first.stackTrace);
  const summary = `Passed after ${plural(flaky.length, 'failed attempt')}.`;
  return { status: 'passed', notes: message ? `${summary}\n\nFirst failure: ${message}` : summary };
}

function attachmentsOf(
  testcase: JUnitTestCase,
  label: string,
  context: Context,
): AttachmentInput[] {
  const attachments = referencedPaths(testcase).map((path) => {
    const { attachment, found } = resolveAttachment(path, context.reportDir, context.cwd);
    if (!found) {
      context.warnings.push(
        `${context.options.filePath}: attachment "${path}" of "${label}" was not found`,
      );
    }
    return attachment;
  });
  return context.options.attachOutput === true
    ? [...attachments, ...outputAttachments(testcase)]
    : attachments;
}

/** Whether core drops the segment: nothing but whitespace and control characters. */
function isBlankSegment(segment: string): boolean {
  return /^[\s\p{Cc}]*$/u.test(segment);
}

function classnameNote(testcase: JUnitTestCase): string {
  return testcase.classname === undefined ? '' : ` (classname "${testcase.classname}")`;
}

function toResults(
  testcase: JUnitTestCase,
  suite: JUnitSuite,
  context: Context,
): TestResultInput[] {
  const { name } = testcase;
  if (name === undefined || name.trim() === '') {
    context.warnings.push(
      `${context.options.filePath}: skipped a testcase without a name${classnameNote(testcase)}`,
    );
    return [];
  }

  const parts = context.mapping.identity({ ...testcase, name }, suite, context.document);
  const titled = extractTitlePathCaseIds(parts.name, context.options.projectCodes);
  if (titled.titlePath.every(isBlankSegment)) {
    // Core would reject it as an identity without a title: it is an input problem, not a bug.
    context.warnings.push(
      `${context.options.filePath}: skipped a testcase without a title: its name "${name}" holds only separators${classnameNote(testcase)}`,
    );
    return [];
  }
  const titlePath = [...parts.context, ...titled.titlePath];
  const ids = [
    ...testcase.properties
      .filter((property) => property.name === CASE_ANNOTATION)
      .flatMap((property) => parseCaseIdList(property.value)),
    ...titled.ids,
  ];

  const label = [...(parts.file === undefined ? [] : [parts.file]), ...titlePath].join(' > ');
  const attachments = attachmentsOf(testcase, label, context);
  const startedAt = context.mapping.startedAt(suite);
  const result: TestResultInput = {
    identity: {
      ...(parts.file === undefined ? {} : { file: parts.file }),
      titlePath,
      ...(parts.parameters === undefined ? {} : { parameters: parts.parameters }),
    },
    ...outcomeOf(testcase, context),
    ...(parts.suitePath === undefined ? {} : { suitePath: parts.suitePath }),
    ...(testcase.time === undefined ? {} : { durationMs: Math.round(testcase.time * 1000) }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(attachments.length === 0 ? {} : { attachments }),
    caseDisplayIds: ids,
  };
  // One result per linked case, as core sends them, so the counts and the dry run match the import.
  return fanOutByCase(result);
}

/**
 * Converts one JUnit XML report into Probara results: the dialect is detected from the report
 * (unless given), and every testcase becomes one result per linked case, in document order.
 *
 * @throws JUnitParseError when the text is not well-formed XML or not a JUnit report.
 */
export function junitToResults(xml: string, options: JUnitToResultsOptions): JUnitConversion {
  const document = parseJUnit(xml, options.filePath);
  const dialect = options.dialect ?? detectDialect(document);
  const cwd = options.cwd ?? process.cwd();
  const context: Context = {
    mapping: DIALECT_MAPPINGS[dialect],
    document,
    options,
    reportDir: dirname(resolve(cwd, options.filePath)),
    cwd,
    warnings: [],
  };
  const results = document.suites.flatMap((suite) =>
    context.mapping.testcases(suite).flatMap((testcase) => toResults(testcase, suite, context)),
  );
  return { dialect, results, warnings: context.warnings };
}
