/** What a run of the fixture projects reports, entry by entry: the key, the case, the statuses. */
import type { ReportRequest } from '@probara/core';
import { buildAutomationKey } from '@probara/core/metadata';

type Status = 'passed' | 'failed' | 'skipped';

/** `<automation key> | <case display id or ->` → the status of each attempt, in order. */
export type Entries = Record<string, Status[]>;

/** The entries of every report, grouped by key and case, attempts in the order they were sent. */
export function entriesOf(reports: readonly ReportRequest[]): Entries {
  const entries: Entries = {};
  for (const result of reports.flatMap((report) => report.results)) {
    const label = `${result.automationKey ?? '?'} | ${result.caseDisplayId ?? '-'}`;
    (entries[label] ??= []).push(result.status as Status);
  }
  return entries;
}

/**
 * Every entry of a run of the `project` fixture, keyed with the file (`keyIncludesFile`). Each
 * statement of the fixture says what it is: a status, a case, or a name Vitest formats.
 */
export const PROJECT_RUN: Entries = {
  // The case id of the title is linked and out of the key; the describes are the path.
  'tests/checkout.test.ts > checkout > accepts café and ñandú | SHOP-12': ['passed'],
  'tests/checkout.test.ts > checkout > rejects a wrong coupon | -': ['failed'],
  'tests/checkout.test.ts > checkout > supports SSO | -': ['skipped'],
  // A todo is skipped, with the note Todo.
  'tests/checkout.test.ts > checkout > remembers the device | -': ['skipped'],
  // test.fails: a throwing body passes, a passing one fails.
  'tests/checkout.test.ts > checkout > is a known bug | -': ['passed'],
  'tests/checkout.test.ts > checkout > was fixed but is still marked as failing | -': ['failed'],
  'tests/checkout.test.ts > checkout > collects every soft failure | -': ['failed'],
  // test.each and test.for: the formatted title is the key.
  'tests/checkout.test.ts > checkout > username alice is accepted | -': ['passed'],
  'tests/checkout.test.ts > checkout > username bob is accepted | -': ['passed'],
  'tests/checkout.test.ts > checkout > number 1 doubles | -': ['passed'],
  'tests/checkout.test.ts > checkout > number 2 doubles | -': ['passed'],
  'tests/checkout.test.ts > checkout > skipped by a condition | -': ['skipped'],
  'tests/checkout.test.ts > checkout > runs only elsewhere | -': ['skipped'],
  'tests/checkout.test.ts > checkout > session > WEB-7 renews the token before expiry | -': [
    'passed',
  ],
  // Only the `only` test of its file runs; its sibling is skipped.
  'tests/only.test.ts > runs alone | -': ['passed'],
  'tests/only.test.ts > is skipped next to an only | -': ['skipped'],
};

/** A test of the parity suite, as the reporter and `probara import junit` must both name it. */
export interface SuiteTest {
  /** Its file, relative to the Vitest root. */
  file: string;
  /** Its describes and title, the case ids taken out, as core keys them. */
  titlePath: readonly string[];
  /** The case its title, or one of its describes, links. */
  caseId?: string;
  status: Status;
}

/**
 * The parity suite (`test/fixtures/parity`), test by test, in file order: nested describes, case ids
 * in titles and describes, every kind of skip, a todo, `test.fails`, soft failures, `test.each` and
 * `test.for`, a title holding ` > `, a retry, a `beforeAll` and an `afterAll` that throw, and a file
 * that does not load. The synthetic failures are named as Vitest's JUnit output names them.
 */
export const SUITE: readonly SuiteTest[] = [
  {
    file: 'tests/suite.test.ts',
    titlePath: ['checkout', 'accepts café and ñandú'],
    caseId: 'SHOP-12',
    status: 'passed',
  },
  {
    file: 'tests/suite.test.ts',
    titlePath: ['checkout', 'rejects a wrong coupon'],
    status: 'failed',
  },
  { file: 'tests/suite.test.ts', titlePath: ['checkout', 'supports SSO'], status: 'skipped' },
  {
    file: 'tests/suite.test.ts',
    titlePath: ['checkout', 'remembers the device'],
    status: 'skipped',
  },
  { file: 'tests/suite.test.ts', titlePath: ['checkout', 'is a known bug'], status: 'passed' },
  {
    file: 'tests/suite.test.ts',
    titlePath: ['checkout', 'was fixed but is still marked as failing'],
    status: 'failed',
  },
  {
    file: 'tests/suite.test.ts',
    titlePath: ['checkout', 'collects every soft failure'],
    status: 'failed',
  },
  {
    file: 'tests/suite.test.ts',
    titlePath: ['checkout', 'username alice is accepted'],
    status: 'passed',
  },
  {
    file: 'tests/suite.test.ts',
    titlePath: ['checkout', 'username bob is accepted'],
    status: 'passed',
  },
  { file: 'tests/suite.test.ts', titlePath: ['checkout', 'number 1 doubles'], status: 'passed' },
  { file: 'tests/suite.test.ts', titlePath: ['checkout', 'number 2 doubles'], status: 'passed' },
  {
    file: 'tests/suite.test.ts',
    titlePath: ['checkout', 'skipped by a condition'],
    status: 'skipped',
  },
  {
    file: 'tests/suite.test.ts',
    titlePath: ['checkout', 'runs only elsewhere'],
    status: 'skipped',
  },
  {
    file: 'tests/suite.test.ts',
    titlePath: ['checkout', 'keeps a', 'in its title'],
    status: 'passed',
  },
  {
    file: 'tests/suite.test.ts',
    titlePath: ['checkout', 'session', 'WEB-7 renews the token before expiry'],
    status: 'passed',
  },
  { file: 'tests/only.test.ts', titlePath: ['runs alone'], status: 'passed' },
  { file: 'tests/only.test.ts', titlePath: ['is skipped next to an only'], status: 'skipped' },
  {
    file: 'tests/nested/checkout.test.ts',
    titlePath: ['Refunds', 'Partial', 'refunds one item'],
    caseId: 'SHOP-30',
    status: 'passed',
  },
  {
    file: 'tests/nested/checkout.test.ts',
    titlePath: ['Refunds', 'refunds the whole order'],
    caseId: 'SHOP-30',
    status: 'passed',
  },
  {
    file: 'tests/nested/checkout.test.ts',
    titlePath: ['is paid by invoice'],
    caseId: 'SHOP-31',
    status: 'passed',
  },
  {
    file: 'tests/nested/checkout.test.ts',
    titlePath: ['runs in the root of its file'],
    status: 'passed',
  },
  // The `beforeAll` that throws fails its suite, and its test is skipped.
  { file: 'tests/hooks.test.ts', titlePath: ['session'], status: 'failed' },
  {
    file: 'tests/hooks.test.ts',
    titlePath: ['session', 'renews the token before expiry'],
    status: 'skipped',
  },
  // The `afterAll` that throws fails its suite; its test passed before it.
  { file: 'tests/hooks.test.ts', titlePath: ['teardown'], status: 'failed' },
  {
    file: 'tests/hooks.test.ts',
    titlePath: ['teardown', 'passes before its afterAll fails'],
    status: 'passed',
  },
  { file: 'tests/hooks.test.ts', titlePath: ['cart', 'adds an item'], status: 'passed' },
  // A file that does not load fails, named by its file.
  {
    file: 'tests/broken-import.test.ts',
    titlePath: ['tests/broken-import.test.ts'],
    status: 'failed',
  },
  { file: 'tests/retry.test.ts', titlePath: ['passes on its retry'], status: 'passed' },
  { file: 'tests/retry.test.ts', titlePath: ['fails on every attempt'], status: 'failed' },
];

/** `<automation key> | <case display id or ->` of a test: its key with the file, or without it. */
export function labelOf(test: SuiteTest, withFile: boolean): string {
  const identity = withFile
    ? { file: test.file, titlePath: [...test.titlePath] }
    : { titlePath: [...test.titlePath] };
  return `${buildAutomationKey(identity)} | ${test.caseId ?? '-'}`;
}

/** What every test of the suite sends once, as its JUnit result says: one result per test. */
export function expectedEntries(withFile: boolean): Entries {
  return Object.fromEntries(
    SUITE.map((test): [string, Status[]] => [labelOf(test, withFile), [test.status]]),
  );
}

/** The labels of some entries, sorted: the keys and the case links, without the statuses. */
export function labelsOf(entries: Entries): string[] {
  return Object.keys(entries).sort();
}

/** The status of the last attempt of each label: the result the test ended with. */
export function lastStatusesOf(entries: Entries): Record<string, Status> {
  return Object.fromEntries(
    Object.entries(entries).flatMap(([label, statuses]) => {
      const last = statuses.at(-1);
      return last === undefined ? [] : [[label, last] as const];
    }),
  );
}

/** The attempts of each label before its last one: the results a test has beyond its final state. */
export function earlierAttemptsOf(entries: Entries): Entries {
  return Object.fromEntries(
    Object.entries(entries).flatMap(([label, statuses]) =>
      statuses.length > 1 ? [[label, statuses.slice(0, -1)] as const] : [],
    ),
  );
}

/**
 * Every entry the reporter sends for the suite, in order, by key: the earlier attempts of a test
 * (`EARLIER_ATTEMPTS`, which name the file, so the keys with the file are looked up), then its final
 * state. `withFile` picks the keys: with the file, or without it (`keyIncludesFile: false`).
 */
export function sentEntries(withFile: boolean): Entries {
  return Object.fromEntries(
    SUITE.map((test): [string, Status[]] => [
      labelOf(test, withFile),
      [...(EARLIER_ATTEMPTS[labelOf(test, true)] ?? []), test.status],
    ]),
  );
}

/**
 * The earlier attempts the reporter sends beyond the one result per test that Vitest's JUnit output
 * holds, by label: the failure a passing retry recovers from (`retry: 1`), and the two failures before
 * the last one of the test that fails on every attempt (`retry: 2`). JUnit holds one `<failure>` per
 * failed attempt of the second kind, and none for the first: the import keeps only the first.
 */
export const EARLIER_ATTEMPTS: Entries = {
  'tests/retry.test.ts > passes on its retry | -': ['failed'],
  'tests/retry.test.ts > fails on every attempt | -': ['failed', 'failed'],
};

/**
 * What a run of the `attempts` fixture reports: every execution of each test, in the order it ran,
 * by key and case. A test that was never retried or repeated has one execution.
 */
export const ATTEMPTS_RUN: Entries = {
  'tests/attempts.test.ts > plain passes | -': ['passed'],
  'tests/attempts.test.ts > passes on its second attempt | -': ['failed', 'passed'],
  'tests/attempts.test.ts > fails on every attempt | -': ['failed', 'failed', 'failed'],
  'tests/attempts.test.ts > repeats, and retries each repeat | -': [
    'failed',
    'passed',
    'failed',
    'passed',
    'failed',
    'passed',
  ],
  'tests/attempts.test.ts > concurrent passes on its second attempt | -': ['failed', 'passed'],
  'tests/attempts.test.ts > concurrent passes first | -': ['passed'],
  'tests/attempts.test.ts > is a known bug kept failing | -': ['failed'],
};

/**
 * The parameters of each execution of the retried or repeated tests of `ATTEMPTS_RUN`, in order: the
 * `attempt` from the second attempt on, and the `repeat` from the second repeat on (V-D10).
 */
export const ATTEMPT_PARAMETERS: Readonly<Record<string, readonly Record<string, string>[]>> = {
  'tests/attempts.test.ts > passes on its second attempt | -': [{}, { attempt: '2' }],
  'tests/attempts.test.ts > fails on every attempt | -': [{}, { attempt: '2' }, { attempt: '3' }],
  'tests/attempts.test.ts > repeats, and retries each repeat | -': [
    {},
    { attempt: '2' },
    { repeat: '2' },
    { repeat: '2', attempt: '2' },
    { repeat: '3' },
    { repeat: '3', attempt: '2' },
  ],
  'tests/attempts.test.ts > concurrent passes on its second attempt | -': [{}, { attempt: '2' }],
};
