/**
 * Reads the reported tasks of one test file (Vitest's `TestModule`) into the facts `translate.ts`
 * takes: each test, the failures the JUnit writer reports as tests (a file that failed outside its
 * tests, a suite whose hook threw), and whether the file never got to run. Types only from
 * `vitest/node`: the reporter never imports Vitest at run time.
 */
import { normalizeTestFile } from '@probara/core';
import type { TestCase, TestModule, TestSuite } from 'vitest/node';
import type { ReportedError, ReportedFailure, ReportedTest } from './translate.js';

/** What one test file of the run holds, once read. */
export interface ModuleFacts {
  tests: ReportedTest[];
  failures: ReportedFailure[];
  /** `true` for a file that was queued or never started: it has no test to report. */
  neverRan: boolean;
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

/** A test as its result says it ended: its state, its note, its errors, its time. */
function testOf(test: TestCase): ReportedTest {
  const result = test.result();
  const diagnostic = test.diagnostic();
  return {
    file: test.module.moduleId,
    ancestors: ancestorsOf(test),
    title: test.name,
    state: result.state,
    todo: test.options.mode === 'todo',
    ...(result.state === 'skipped' && result.note !== undefined ? { note: result.note } : {}),
    errors: (result.errors ?? []).map(errorOf),
    ...(diagnostic === undefined
      ? {}
      : { durationMs: diagnostic.duration, startedAt: diagnostic.startTime }),
  };
}

/**
 * The facts of one file of the run. `root` is the Vitest root, which the file's name is relative
 * to. Failures follow the JUnit writer: the file's own errors (a file that failed to import, or
 * failed outside its tests) are named by the file, and every suite (nested ones too) whose hook
 * threw is named by the suite.
 */
export function factsOf(module: TestModule, root: string): ModuleFacts {
  const cases = [...module.children.allTests()];
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
    tests: cases.map(testOf),
    failures,
    neverRan: cases.length === 0 && (state === 'queued' || state === 'pending'),
  };
}
