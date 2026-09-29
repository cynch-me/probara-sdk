/** A JUnit XML report, independent of the tool that wrote it. */
export interface JUnitDocument {
  /** The root element: a `testsuites` wrapper, or a single `testsuite` (Surefire). */
  root: 'testsuites' | 'testsuite';
  /** Attributes of the root element. */
  attributes: Readonly<Record<string, string>>;
  /** Every `testsuite`, nested ones flattened after their parent, in document order. */
  suites: JUnitSuite[];
}

export interface JUnitProperty {
  name: string;
  value: string;
}

export interface JUnitSuite {
  name?: string;
  timestamp?: string;
  hostname?: string;
  attributes: Readonly<Record<string, string>>;
  properties: JUnitProperty[];
  systemOut: string[];
  systemErr: string[];
  testcases: JUnitTestCase[];
}

export interface JUnitTestCase {
  name?: string;
  classname?: string;
  file?: string;
  /** Seconds, when the `time` attribute is a number. */
  time?: number;
  properties: JUnitProperty[];
  /** Outcome elements in document order; none means the test passed. */
  outcomes: JUnitOutcome[];
  systemOut: string[];
  systemErr: string[];
}

export type JUnitOutcomeKind =
  'failure' | 'error' | 'skipped' | 'flakyFailure' | 'flakyError' | 'rerunFailure' | 'rerunError';

/** One outcome element: `<failure>`, `<error>`, `<skipped>`, or an attempt of a rerun test. */
export interface JUnitOutcome {
  kind: JUnitOutcomeKind;
  message?: string;
  type?: string;
  /** Text content, when not blank. */
  body?: string;
  /** The `<stackTrace>` of a flaky or rerun attempt. */
  stackTrace?: string;
  /** Output of a flaky or rerun attempt. */
  systemOut: string[];
  systemErr: string[];
}
