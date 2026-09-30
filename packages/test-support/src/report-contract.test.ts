import { describe, expect, it } from 'vitest';
import { caseFieldWarnings, createRunIssues, reportIssues } from './report-contract.js';

const entry = { automationKey: 'cart.spec.ts > pays', status: 'passed' };

function report(extra: Record<string, unknown> = {}, run: unknown = { name: 'Nightly' }) {
  return { run, results: [{ ...entry, ...extra }] };
}

function chain(levels: number): unknown[] {
  let steps: unknown[] | undefined;
  for (let level = levels; level >= 1; level -= 1) {
    steps = [{ action: `level ${level}`, status: 'passed', ...(steps ? { steps } : {}) }];
  }
  return steps ?? [];
}

describe('reportIssues', () => {
  it('accepts a report with every field of an entry within the contract', () => {
    expect(
      reportIssues(
        report({
          parameters: { ' browser ': 'chromium' },
          steps: [
            {
              action: 'Pay',
              status: 'failed',
              durationMs: 3,
              error: 'x',
              expected: 'Paid',
              data: 'visa',
              steps: [{ action: 'Click', status: 'passed' }],
            },
          ],
          case: {
            description: null,
            tags: ['smoke'],
            fields: { Priority: 'high' },
            steps: [{ action: 'Pay', expected: null, data: 'visa' }],
          },
        }),
      ),
    ).toEqual([]);
    expect(reportIssues(report({ steps: chain(10) }))).toEqual([]);
  });

  it('refuses unknown keys, and parameters the server refuses', () => {
    expect(reportIssues(report({ extra: 1 }))).toEqual(['results[0]: unrecognized keys extra']);
    expect(reportIssues(report({ parameters: { a: '1', ' a ': '2' } }))).toEqual([
      'results[0].parameters. a : repeats another name once trimmed',
    ]);
    expect(
      reportIssues(report({ parameters: JSON.parse('{"__proto__":"x"}') as unknown })),
    ).toEqual(['results[0].parameters: a name cannot be __proto__']);
    expect(reportIssues(report({ parameters: { ['n'.repeat(101)]: 'v' } }))[0]).toMatch(
      /a name has 1–100 characters once trimmed$/,
    );
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`p${index}`, 'v']));
    expect(reportIssues(report({ parameters: many }))).toEqual([
      'results[0].parameters: must hold at most 20 names',
    ]);
  });

  it('refuses steps nested too deep, too many, blank or of an unknown status', () => {
    expect(reportIssues(report({ steps: chain(11) }))).toEqual([
      'results[0].steps[0].steps[0].steps[0].steps[0].steps[0].steps[0].steps[0].steps[0].steps[0].steps[0]: unrecognized keys steps',
    ]);
    const steps = Array.from({ length: 101 }, () => ({
      action: 'a',
      status: 'passed',
      steps: [{ action: 'b', status: 'passed' }],
    }));
    expect(reportIssues(report({ steps }))).toEqual([
      'results[0].steps: each result carries at most 200 steps across all levels',
    ]);
    expect(reportIssues(report({ steps: [{ action: ' ', status: 'timedOut' }] }))).toEqual([
      'results[0].steps[0].action: must have at least 1 characters',
      'results[0].steps[0].status: is not a status',
    ]);
  });

  it('refuses case fields repeated ignoring case, and parts over their limits', () => {
    expect(reportIssues(report({ case: { fields: { Priority: 'a', priority: 'b' } } }))).toEqual([
      'results[0].case.fields.priority: repeats another name once trimmed',
    ]);
    expect(reportIssues(report({ case: { tags: ['t'.repeat(81)] } }))).toEqual([
      'results[0].case.tags[0]: must have at most 80 characters',
    ]);
    expect(reportIssues(report({ case: { steps: [{ action: 'x', note: 'y' }] } }))).toEqual([
      'results[0].case.steps[0]: unrecognized keys note',
    ]);
  });

  it('refuses a report over a per-report total, counted over every entry', () => {
    const tags = Array.from({ length: 50 }, (_, index) => `tag ${index}`);
    const results = Array.from({ length: 21 }, (_, index) => ({
      automationKey: `key ${index}`,
      status: 'passed',
      case: { tags },
    }));
    expect(reportIssues({ run: { name: 'Nightly' }, results })).toEqual([
      'results: a report carries at most 1000 case tag names',
    ]);
    expect(reportIssues({ run: { name: 'Nightly' }, results: results.slice(0, 20) })).toEqual([]);
  });

  it('refuses both forms of one run reference, and malformed configurations', () => {
    expect(
      reportIssues(report({}, { name: 'Nightly', environment: 'staging', environmentId: null })),
    ).toEqual([]);
    expect(
      reportIssues(
        report(
          {},
          {
            name: 'Nightly',
            milestone: 'M-1',
            milestoneId: '01J9Z3K4M5N6P7Q8R9S0T1V2W3',
            configurations: [
              { group: 'OS', name: 'Linux' },
              { group: 'OS', name: 'macOS' },
            ],
          },
        ),
      ),
    ).toEqual([
      'run.configurations: names a group twice',
      'run.milestone: not together with milestoneId',
    ]);
    // A report's run takes the plan by name only.
    expect(
      reportIssues(report({}, { name: 'Nightly', planUlid: '01J9Z3K4M5N6P7Q8R9S0T1V2W3' })),
    ).toEqual(['run: unrecognized keys planUlid']);
  });
});

describe('createRunIssues', () => {
  it('checks the references of a run to create, planUlid and plan included', () => {
    expect(createRunIssues({ name: 'Nightly', plan: 'Smoke', automated: true })).toEqual([]);
    expect(
      createRunIssues({ name: 'Nightly', plan: 'Smoke', planUlid: '01J9Z3K4M5N6P7Q8R9S0T1V2W3' }),
    ).toEqual(['body.plan: not together with planUlid']);
    expect(createRunIssues({ name: 'Nightly', environment: 'e'.repeat(81) })).toEqual([
      'body.environment: must have at most 80 characters',
    ]);
  });
});

describe('caseFieldWarnings', () => {
  it('skips the fields that are neither system fields nor known custom fields, ignoring case', () => {
    expect(
      caseFieldWarnings({ Priority: 'high', Sevrity: 'x', ' Browser ': 'y' }, ['browser']),
    ).toEqual(['Unknown field "Sevrity" was skipped']);
  });
});
