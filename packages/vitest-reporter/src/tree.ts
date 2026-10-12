/**
 * Reads the reported tasks of one test file (Vitest's `TestModule`) into the facts `translate.ts`
 * takes: each execution of each test (see `executionsOf`), the failures the JUnit writer reports as
 * tests (a file that failed outside its tests, a suite whose hook threw), and whether the file never
 * got to run. Types only from
 * `vitest/node`: the reporter never imports Vitest at run time.
 */
import { normalizeTestFile } from '@probara/core';
import type { TestCase, TestModule, TestSuite } from 'vitest/node';
import { executionsOf, type AttemptError, type EndedTest } from './attempts.js';
import type { ReportedError, ReportedFailure, ReportedTest } from './translate.js';

/** What one test file of the run holds, once read. */
export interface ModuleFacts {
  /** One entry per execution of each test, in the order they ran. */
  tests: ReportedTest[];
  failures: ReportedFailure[];
  /** `true` for a file that was queued or never started: it has no test to report. */
  neverRan: boolean;
  /** The tests Vitest retried or repeated whose attempts were not recorded. */
  unrecorded: number;
}

/** The message and stack of a Vitest error, as far as they are strings. */
function errorOf(error: { message?: unknown; stack?: unknown }): ReportedError {
  return {
    ...(typeof error.message === 'string' ? { message: error.message } : {}),
    ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
  };
}

/** The describes of a test, outermost first: its parents up to the file. */
function ancestorsOf(test: TestCase): string[] {
  const names: string[] = [];
  let parent: TestSuite | TestModule = test.parent;
  while (parent.type === 'suite') {
    names.unshift(parent.name);
    parent = parent.parent;
  }
  return names;
}

/** What a test's result says it ended with: its state, its note, its errors, its time, its retries. */
function endedOf(test: TestCase): EndedTest {
  const result = test.result();
  const diagnostic = test.diagnostic();
  const probara = test.meta().probara;
  return {
    state: result.state,
    ...(result.state === 'skipped' && result.note !== undefined ? { note: result.note } : {}),
    errors: (result.errors ?? []).map((error): AttemptError => errorOf(error)),
    ...(diagnostic === undefined
      ? {}
      : { durationMs: diagnostic.duration, startedAt: diagnostic.startTime }),
    retryCount: diagnostic?.retryCount ?? 0,
    repeatCount: diagnostic?.repeatCount ?? 0,
    ...(probara?.lines === undefined ? {} : { lines: probara.lines }),
    linesTry: probara?.linesTry,
  };
}

/** The native tags of a test (Vitest 4.1 and later): none where the API has no tags. */
function tagsOf(test: TestCase): string[] {
  const tags: unknown = Reflect.get(test, 'tags');
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [];
}

/**
 * The facts of one file of the run. `root` is the Vitest root, which the file's name is relative
 * to. Failures follow the JUnit writer: the file's own errors (a file that failed to import, or
 * failed outside its tests) are named by the file, and every suite (nested ones too) whose hook
 * threw is named by the suite.
 */
export function factsOf(module: TestModule, root: string): ModuleFacts {
  const cases = [...module.children.allTests()];
  const tests: ReportedTest[] = [];
  let unrecorded = 0;
  for (const test of cases) {
    const { executions, unrecorded: missing } = executionsOf(
      test.meta().probara?.attempts,
      endedOf(test),
    );
    if (missing) unrecorded += 1;
    const file = test.module.moduleId;
    const ancestors = ancestorsOf(test);
    const todo = test.options.mode === 'todo';
    const tags = tagsOf(test);
    for (const execution of executions) {
      tests.push({ file, ancestors, title: test.name, todo, tags, ...execution });
    }
  }
  const failures: ReportedFailure[] = [];
  const fileErrors = module.errors();
  if (fileErrors.length > 0) {
    failures.push({
      file: module.moduleId,
      name: normalizeTestFile(module.moduleId, root),
      errors: fileErrors.map(errorOf),
    });
  }
  for (const suite of module.children.allSuites()) {
    const errors = suite.errors();
    if (errors.length > 0) {
      failures.push({ file: module.moduleId, name: suite.name, errors: errors.map(errorOf) });
    }
  }
  const state = module.state();
  return {
    tests,
    failures,
    neverRan: cases.length === 0 && (state === 'queued' || state === 'pending'),
    unrecorded,
  };
}
