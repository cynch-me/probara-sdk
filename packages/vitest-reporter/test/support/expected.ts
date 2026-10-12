/** What a run of the fixture projects reports, entry by entry: the key, the case, the statuses. */
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
