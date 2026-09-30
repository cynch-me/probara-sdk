/**
 * Jest reporter objects for unit tests, typed against Jest's own reporter types and shaped like
 * what real Jest 29.7 and 30.5 hand a reporter (see the spike notes in the feature document): only
 * the members the reporter reads are real. Jest 30 adds `startedAt` to each case result and
 * `startAt` to each entry of a file result; Jest 29 has neither.
 */
import type { Test, TestCaseResult, TestResult } from '@jest/reporters';

export const ROOT_DIR = '/work/app';

export type JestVersion = 29 | 30;

/** A test file as Jest hands it to every hook: `path` is absolute. */
export function fakeTest(file = 'src/login.test.js', displayName?: string): Test {
  return {
    path: `${ROOT_DIR}/${file}`,
    duration: undefined,
    context: {
      config: {
        rootDir: ROOT_DIR,
        ...(displayName === undefined ? {} : { displayName: { name: displayName, color: 'blue' } }),
      },
    },
  } as unknown as Test;
}

export interface FakeCase {
  /** Describe titles, then the test title. */
  titles?: readonly string[];
  status?: TestCaseResult['status'];
  duration?: number | null;
  failureMessages?: string[];
  invocations?: number;
  /** When the attempt started (Jest 30 only). */
  startedAt?: number;
}

function namesOf(titles: readonly string[]) {
  const ancestorTitles = titles.slice(0, -1);
  const title = titles[titles.length - 1] ?? '';
  return { ancestorTitles, title, fullName: [...ancestorTitles, title].join(' ') };
}

/** What `onTestCaseStart` receives (the same on 29 and 30). */
export function fakeCaseStart(titles: readonly string[], startedAt: number) {
  return { ...namesOf(titles), startedAt };
}

/** One attempt as `onTestCaseResult` receives it. */
export function fakeCaseResult(version: JestVersion, fake: FakeCase = {}): TestCaseResult {
  const status = fake.status ?? 'passed';
  return {
    ...namesOf(fake.titles ?? ['login', 'logs in']),
    status,
    duration: fake.duration === undefined ? 3 : fake.duration,
    failureMessages: fake.failureMessages ?? [],
    failureDetails: [],
    invocations: fake.invocations ?? 1,
    retryReasons: [],
    numPassingAsserts: 0,
    location: null,
    ...(version === 30
      ? {
          startedAt: fake.startedAt ?? Date.parse('2026-09-30T10:00:00.000Z'),
          failing: false,
          retryMessages: [],
        }
      : {}),
  };
}

export interface FakeFile {
  testExecError?: { message: string; stack?: string };
  /** When the file started (`perfStats.start`). */
  start?: number;
}

/**
 * What `onTestFileResult` receives: the last attempt of each test, and every skipped one (status
 * `pending`, no duration), which never reached `onTestCaseResult`. Jest 30 names the start of each
 * entry `startAt`.
 */
export function fakeFileResult(
  version: JestVersion,
  test: Test,
  cases: readonly TestCaseResult[],
  fake: FakeFile = {},
): TestResult {
  const start = fake.start ?? Date.parse('2026-09-30T09:59:59.000Z');
  return {
    testFilePath: test.path,
    testResults: cases.map((each) => {
      const { startedAt, ...rest } = each as TestCaseResult & { startedAt?: number };
      return version === 30 ? { ...rest, startAt: startedAt ?? start } : rest;
    }),
    perfStats: {
      start,
      end: start + 100,
      runtime: 100,
      slow: false,
      loadTestEnvironmentEnd: 0,
      loadTestEnvironmentStart: 0,
      setupAfterEnvEnd: 0,
      setupAfterEnvStart: 0,
      setupFilesEnd: 0,
      setupFilesStart: 0,
    },
    numFailingTests: 0,
    numPassingTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    leaks: false,
    openHandles: [],
    skipped: false,
    snapshot: {},
    console: undefined,
    displayName: undefined,
    failureMessage: null,
    ...(fake.testExecError === undefined ? {} : { testExecError: fake.testExecError }),
  } as unknown as TestResult;
}
