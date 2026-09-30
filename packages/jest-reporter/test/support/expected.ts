/** What a run of the fixture project reports, entry by entry: the key, the case, the statuses. */
import type { ReportRequest } from '@probara/core';

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

/** The keys and cases of `entries`, without the statuses: what the JUnit import must match. */
export function labelsOf(entries: Entries): string[] {
  return Object.keys(entries).sort();
}

/** Every entry of a full run of the fixture project, keyed with the file (`keyIncludesFile`). */
export const FULL_RUN: Entries = {
  'tests/login.test.js > login logs in with a valid password | SHOP-12': ['passed'],
  'tests/login.test.js > login rejects a wrong password | -': ['failed'],
  'tests/login.test.js > login supports SSO | -': ['skipped'],
  // A todo is kept, as skipped (the JUnit import reads it as passed).
  'tests/login.test.js > login remembers the device | -': ['skipped'],
  // test.failing: a throwing body passes, a passing one fails.
  'tests/login.test.js > login is a known bug | -': ['passed'],
  'tests/login.test.js > login was fixed but is still marked as failing | -': ['failed'],
  'tests/login.test.js > login session refresh renews the token | -': ['passed'],
  'tests/login.test.js > login username alice has length 5 | -': ['passed'],
  'tests/login.test.js > login username bob has length 3 | -': ['passed'],
  'tests/login.test.js > top-level test outside any describe | -': ['passed'],
  // Every attempt of jest.retryTimes is a result of its own.
  'tests/retry.test.js > retries is flaky and passes on retry | -': ['failed', 'passed'],
  'tests/cart.test.js > cart adds an item | -': ['passed'],
  'tests/cart.test.js > cart WEB-7 keeps another project id in its title | -': ['passed'],
  'tests/nested/checkout.test.js > checkout pays by card | -': ['passed'],
};

/** The same entries keyed without the file (`keyIncludesFile: false`). */
export const FULL_RUN_WITHOUT_FILE: Entries = Object.fromEntries(
  Object.entries(FULL_RUN).map(([label, statuses]) => [label.replace(/^[^>]+> /, ''), statuses]),
);
