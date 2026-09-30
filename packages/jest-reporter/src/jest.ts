/**
 * The parts of Jest's reporter objects the reporter reads, as Jest 29.6 and later hand them over.
 * Declared here rather than imported from `@jest/reporters`, which a project need not install: the
 * reporter's types then hold on every Jest version of the peer range.
 */

/** A test file (`Test` of `@jest/reporters`). */
export interface JestTest {
  /** The absolute, real path of the file. */
  path: string;
  /**
   * The Jest project that runs the file: right in `onTestFileStart` and `onTestFileResult` only.
   * Jest hands the case events (`onTestCaseStart`, `onTestCaseResult`) the first project's.
   */
  context?: { config?: { id?: unknown; displayName?: unknown } };
}

/** What `onTestCaseStart` receives: the start of one attempt of a test. */
export interface JestCaseStart {
  ancestorTitles: readonly string[];
  title: string;
  fullName?: string;
  /** Epoch milliseconds. */
  startedAt?: number | null;
}

/** One attempt (`onTestCaseResult`), or one test of a file result (`onTestFileResult`). */
export interface JestAttempt {
  ancestorTitles: readonly string[];
  title: string;
  /** `passed`, `failed`, `pending` (skipped), `todo`, `skipped`, `disabled`, `focused`. */
  status: string;
  /** Milliseconds; `null` for a test that did not run. */
  duration?: number | null;
  failureMessages?: readonly string[];
  /** 1 for the first attempt, 2 for the first retry... */
  invocations?: number;
  /** When the attempt started (Jest 30, in `onTestCaseResult`), epoch milliseconds. */
  startedAt?: number | null;
  /** When the test started (Jest 30, in a file result), epoch milliseconds. */
  startAt?: number | null;
}

/** What `onTestFileResult` receives: the last attempt of each test of the file. */
export interface JestFileResult {
  testResults: readonly JestAttempt[];
  /**
   * Set when the file could not run (a syntax error, a failing import, no tests): no results. Also
   * set, next to its results, when the file failed outside its tests (an `afterAll` hook that
   * throws, an unhandled error), then often with an empty message and the error in `stack`.
   */
  testExecError?: { message?: string | undefined; stack?: string | null | undefined } | null;
  perfStats?: { start?: number } | null;
}
