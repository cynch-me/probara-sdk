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

function namedProject(project: string): Entries {
  const login = (title: string) => `login.spec.js > login > ${title} [project=${project}]`;
  const cart = (title: string) => `nested/cart.spec.js > cart > ${title} [project=${project}]`;
  return {
    [`${login('logs in with a valid password')} | PRB-12`]: ['passed'],
    [`${login('rejects a wrong password')} | -`]: ['failed', 'failed'],
    [`${login('supports SSO')} | -`]: ['skipped'],
    [`${login('remembers the device')} | -`]: ['skipped'],
    // test.fail(): failing as expected passes, passing fails.
    [`${login('is a known bug')} | -`]: ['passed'],
    [`${login('was fixed but is still marked as failing')} | -`]: ['failed', 'failed'],
    [`${login('times out')} | -`]: ['failed', 'failed'],
    [`${login('is flaky and passes on retry')} | -`]: ['failed', 'passed'],
    [`${login('records probara case annotations')} | PRB-13`]: ['passed'],
    [`${login('records probara case annotations')} | PRB-14`]: ['passed'],
    [`${login('adds a probara case annotation at runtime')} | PRB-15`]: ['passed'],
    [`${login('session > refresh > renews the token')} | PRB-16`]: ['passed'],
    [`${login('session > refresh > renews the token')} | PRB-17`]: ['passed'],
    [`${login('attaches a file and a body')} | -`]: ['passed'],
    [`${login('prints to stdout and stderr')} | -`]: ['passed'],
    [`login.spec.js > top-level test outside any describe [project=${project}] | -`]: ['passed'],
    [`${cart('adds an item')} | -`]: ['passed'],
    [`${cart('WEB-7 keeps another project id in its title')} | -`]: ['passed'],
  };
}

/** Every entry of a full run of the fixture project, by key and case. */
export const FULL_RUN: Entries = {
  ...namedProject('alpha'),
  ...namedProject('beta'),
  // The unnamed project only runs the cart tests: no `project` parameter.
  'nested/cart.spec.js > cart > adds an item | -': ['passed'],
  'nested/cart.spec.js > cart > WEB-7 keeps another project id in its title | -': ['passed'],
};
