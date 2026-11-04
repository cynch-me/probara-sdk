/** What a run of the fixture project reports, entry by entry: the key, the case, the statuses. */
import type { ReportRequest } from '@probara/core';

type Status = 'passed' | 'failed' | 'skipped';
type Result = ReportRequest['results'][number];

/**
 * `<automation key> | <case display id or ->`, then ` | <project>` for a result of a named project,
 * → the status of each attempt, in order. The projects of a test share its key, so the project is
 * part of the label: the attempts of each project keep their order.
 */
export type Entries = Record<string, Status[]>;

/** The entries of every report, by key, case and project; attempts in the order they were sent. */
export function entriesOf(reports: readonly ReportRequest[]): Entries {
  const entries: Entries = {};
  for (const result of reports.flatMap((report) => report.results)) {
    (entries[labelOf(result)] ??= []).push(result.status as Status);
  }
  return entries;
}

function labelOf(result: Result): string {
  const label = `${result.automationKey ?? '?'} | ${result.caseDisplayId ?? '-'}`;
  const project = result.parameters?.project;
  return project === undefined ? label : `${label} | ${project}`;
}

/** The keys, cases and projects of `entries`, without the statuses: what the JUnit import must match. */
export function labelsOf(entries: Entries): string[] {
  return Object.keys(entries).sort();
}

function namedProject(project: string): Entries {
  const login = (title: string) => `login.spec.js > login > ${title}`;
  const cart = (title: string) => `nested/cart.spec.js > cart > ${title}`;
  const at = (key: string, caseId = '-') => `${key} | ${caseId} | ${project}`;
  return {
    [at(login('logs in with a valid password'), 'PRB-12')]: ['passed'],
    [at(login('rejects a wrong password'))]: ['failed', 'failed'],
    [at(login('supports SSO'))]: ['skipped'],
    [at(login('remembers the device'))]: ['skipped'],
    // test.fail(): failing as expected passes, passing fails.
    [at(login('is a known bug'))]: ['passed'],
    [at(login('was fixed but is still marked as failing'))]: ['failed', 'failed'],
    [at(login('times out'))]: ['failed', 'failed'],
    [at(login('is flaky and passes on retry'))]: ['failed', 'passed'],
    [at(login('records probara case annotations'), 'PRB-13')]: ['passed'],
    [at(login('records probara case annotations'), 'PRB-14')]: ['passed'],
    [at(login('adds a probara case annotation at runtime'), 'PRB-15')]: ['passed'],
    [at(login('session > refresh > renews the token'), 'PRB-16')]: ['passed'],
    [at(login('session > refresh > renews the token'), 'PRB-17')]: ['passed'],
    [at(login('attaches a file and a body'))]: ['passed'],
    [at(login('prints to stdout and stderr'))]: ['passed'],
    [at('login.spec.js > top-level test outside any describe')]: ['passed'],
    [at(cart('adds an item'))]: ['passed'],
    [at(cart('WEB-7 keeps another project id in its title'))]: ['passed'],
  };
}

/** Every entry of a full run of the fixture project, by key, case and project. */
export const FULL_RUN: Entries = {
  ...namedProject('alpha'),
  ...namedProject('beta'),
  // The unnamed project only runs the cart tests: no `project` parameter.
  'nested/cart.spec.js > cart > adds an item | -': ['passed'],
  'nested/cart.spec.js > cart > WEB-7 keeps another project id in its title | -': ['passed'],
};
