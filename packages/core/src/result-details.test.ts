import { describe, expect, it } from 'vitest';
import {
  MAX_LINK_NAME_LENGTH,
  MAX_LINK_URL_LENGTH,
  MAX_LINKS_PER_RESULT,
  MAX_CASE_FIELDS,
  MAX_CASE_STEPS,
  MAX_CASE_TAGS,
  MAX_PARAMETERS,
  MAX_STEP_DEPTH,
  MAX_STEPS_PER_RESULT,
} from './limits.js';
import { entryTotals, toReportEntry, type TestResultInput, type TestStepInput } from './result.js';

const identity = { file: 'e2e/cart.spec.ts', titlePath: ['cart', 'pays'] };

function convert(extra: Partial<TestResultInput>) {
  return toReportEntry({ identity, status: 'passed', ...extra });
}

/** A chain of `levels` steps, each the only child of the one before. */
function chain(levels: number): TestStepInput[] {
  let steps: TestStepInput[] = [];
  for (let level = levels; level >= 1; level -= 1) {
    steps = [{ action: `level ${level}`, status: 'passed', steps }];
  }
  return steps;
}

describe('toReportEntry parameters', () => {
  it('sends the parameters trimmed, numbers and booleans as strings', () => {
    const { entry, warnings } = convert({
      parameters: { ' browser ': ' chromium ', retries: 2 as unknown as string, headless: 'true' },
    });
    expect(entry.parameters).toEqual({ browser: 'chromium', retries: '2', headless: 'true' });
    expect(warnings).toEqual([]);
  });

  it('leaves out blank names, __proto__, names repeated once trimmed and values that are not text', () => {
    const parameters = JSON.parse(
      '{"a":"1"," a ":"2","":"3","__proto__":"4","b":{"x":1},"c":"5"}',
    ) as Record<string, string>;
    const { entry, warnings } = convert({ parameters });
    expect(entry.parameters).toEqual({ a: '1', c: '5' });
    expect(warnings).toEqual([
      'Ignored a parameter whose name repeats another once trimmed',
      'Ignored a parameter with a blank name',
      'Ignored a parameter named __proto__',
      'Ignored a parameter whose value is not a string',
    ]);
  });

  it('cuts long names and values, and keeps the first 20 parameters', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_PARAMETERS + 3 }, (_, index) => [`p${index}`, String(index)]),
    );
    const { entry, warnings } = convert({
      parameters: { ['n'.repeat(150)]: 'v'.repeat(600), ...many },
    });
    const kept = Object.entries(entry.parameters ?? {});
    expect(kept).toHaveLength(MAX_PARAMETERS);
    expect(kept[0]?.[0]).toHaveLength(100);
    expect(kept[0]?.[1]).toHaveLength(500);
    expect(warnings).toEqual([
      'Truncated a parameter name longer than 100 characters',
      `Dropped the parameters beyond the first ${MAX_PARAMETERS} of a result`,
    ]);
  });

  it('ignores parameters that are not an object, and sends none when none is left', () => {
    const { entry, warnings } = convert({
      parameters: 'browser=chromium' as unknown as Record<string, string>,
    });
    expect(entry).not.toHaveProperty('parameters');
    expect(warnings).toEqual(['Ignored parameters that are not an object']);
    expect(convert({ parameters: { ' ': 'x' } }).entry).not.toHaveProperty('parameters');
  });
});

describe('toReportEntry steps', () => {
  it('sends the step tree with its statuses, durations, errors, expected results and data', () => {
    const { entry, warnings } = convert({
      steps: [
        {
          action: ' Open the cart ',
          status: 'passed',
          durationMs: 12.6,
          expected: ' The cart lists 1 item ',
          data: 'sku=42',
          steps: [{ action: 'Click', status: 'failed', error: { message: 'Boom', stack: 'at x' } }],
        },
        { action: 'Pay', status: 'skipped', durationMs: -3 },
      ],
    });
    expect(entry.steps).toEqual([
      {
        action: 'Open the cart',
        status: 'passed',
        durationMs: 13,
        expected: 'The cart lists 1 item',
        data: 'sku=42',
        steps: [{ action: 'Click', status: 'failed', error: 'Boom\n\nat x' }],
      },
      { action: 'Pay', status: 'skipped', durationMs: 0 },
    ]);
    expect(warnings).toEqual([]);
  });

  it('cuts long actions, texts and errors to their limits', () => {
    const { entry } = convert({
      steps: [
        {
          action: 'a'.repeat(2500),
          status: 'failed',
          expected: 'e'.repeat(2500),
          data: 'd'.repeat(2500),
          error: `\u001b[31m${'x'.repeat(5000)}\u001b[0m`,
        },
      ],
    });
    const [step] = entry.steps ?? [];
    expect(step?.action).toHaveLength(2000);
    expect(step?.expected).toHaveLength(2000);
    expect(step?.data).toHaveLength(2000);
    expect(step?.error).toHaveLength(4000);
    expect(step?.error).toMatch(/^x+\n…\[truncated\]$/);
  });

  it('drops steps without an action or a valid status, with their sub-steps, and says so', () => {
    const { entry, warnings } = convert({
      steps: [
        { action: ' ', status: 'passed', steps: [{ action: 'child', status: 'passed' }] },
        { action: 'timed out', status: 'timedOut' as 'failed' },
        'not a step' as unknown as TestStepInput,
        { action: 'kept', status: 'passed', durationMs: Number.NaN },
      ],
    });
    expect(entry.steps).toEqual([{ action: 'kept', status: 'passed' }]);
    expect(warnings).toEqual([
      'Dropped a step without an action or a status (passed, failed, skipped, blocked), and its sub-steps',
      'Ignored a step durationMs that is not a finite number',
    ]);
  });

  it(`drops the steps nested deeper than ${MAX_STEP_DEPTH} levels`, () => {
    const { entry, warnings } = convert({ steps: chain(MAX_STEP_DEPTH + 2) });
    expect(entryTotals(entry).resultSteps).toBe(MAX_STEP_DEPTH);
    expect(warnings).toEqual([`Dropped the steps nested deeper than ${MAX_STEP_DEPTH} levels`]);
  });

  it(`keeps the first ${MAX_STEPS_PER_RESULT} steps in pre-order`, () => {
    const steps: TestStepInput[] = Array.from({ length: 150 }, (_, index) => ({
      action: `step ${index}`,
      status: 'passed',
      steps: [{ action: `child ${index}`, status: 'passed' }],
    }));
    const { entry, warnings } = convert({ steps });
    expect(entryTotals(entry).resultSteps).toBe(MAX_STEPS_PER_RESULT);
    // Step 99 and its child are the 199th and 200th steps.
    expect(entry.steps?.at(-1)).toEqual({
      action: 'step 99',
      status: 'passed',
      steps: [{ action: 'child 99', status: 'passed' }],
    });
    expect(warnings).toEqual([
      `Dropped the steps beyond the first ${MAX_STEPS_PER_RESULT} of a result`,
    ]);
  });

  it('gives each step file the pre-order index of its step, and the files of dropped steps to the result', () => {
    const file = (name: string) => ({ name, body: name, contentType: 'text/plain' });
    const { entry, stepAttachments } = convert({
      steps: [
        {
          action: 'outer',
          status: 'passed',
          attachments: [file('outer.txt')],
          steps: [
            { action: 'inner', status: 'passed', attachments: [file('inner.txt')] },
            {
              action: '',
              status: 'passed',
              steps: [{ action: 'lost', status: 'passed', attachments: [file('lost.txt')] }],
            },
          ],
        },
        { action: 'second', status: 'failed', attachments: [file('second.txt')] },
      ],
    });
    expect(entryTotals(entry).resultSteps).toBe(3);
    expect(stepAttachments).toEqual([
      { stepIndex: 0, attachments: [file('outer.txt')] },
      { stepIndex: 1, attachments: [file('inner.txt')] },
      { attachments: [file('lost.txt')] },
      { stepIndex: 2, attachments: [file('second.txt')] },
    ]);
  });

  it('ignores steps that are not a list', () => {
    expect(convert({ steps: 'Open' as unknown as TestStepInput[] }).warnings).toEqual([
      'Ignored steps that are not a list',
    ]);
  });
});

describe('toReportEntry case', () => {
  it('sends the description, tags, fields and steps of the case the entry may create', () => {
    const { entry, warnings } = convert({
      case: {
        description: '  Pays with a card.\r\n  ',
        tags: [' smoke ', 'payments', 'Smoke', ' '],
        fields: {
          ' Severity ': 'critical',
          priority: 'high',
          is_flaky: false as unknown as string,
        },
        steps: [
          { action: ' Open the cart ', expected: 'It lists 1 item', data: ' ' },
          { action: 'Pay' },
        ],
      },
    });
    expect(entry.case).toEqual({
      description: 'Pays with a card.',
      tags: ['smoke', 'payments'],
      fields: { Severity: 'critical', priority: 'high', is_flaky: 'false' },
      steps: [{ action: 'Open the cart', expected: 'It lists 1 item' }, { action: 'Pay' }],
    });
    expect(warnings).toEqual([]);
  });

  it('keeps every part within its limits', () => {
    const { entry, warnings } = convert({
      case: {
        description: 'd'.repeat(5000),
        tags: ['t'.repeat(100), ...Array.from({ length: MAX_CASE_TAGS + 5 }, (_, i) => `tag${i}`)],
        fields: {
          ['f'.repeat(201)]: 'x',
          Priority: 'high',
          ' priority ': 'low',
          notes: 'n'.repeat(5000),
          ...Object.fromEntries(
            Array.from({ length: MAX_CASE_FIELDS }, (_, index) => [`field ${index}`, 'v']),
          ),
        },
        steps: [
          { action: '' },
          ...Array.from({ length: MAX_CASE_STEPS + 1 }, (_, index) => ({
            action: `step ${index}`,
            expected: 'e'.repeat(2500),
          })),
        ],
      },
    });
    const created = entry.case;
    expect(created?.description).toHaveLength(4000);
    expect(created?.tags).toHaveLength(MAX_CASE_TAGS);
    expect(created?.tags?.[0]).toHaveLength(80);
    expect(Object.keys(created?.fields ?? {})).toHaveLength(MAX_CASE_FIELDS);
    expect(created?.fields?.Priority).toBe('high');
    expect(created?.fields?.notes).toHaveLength(4000);
    expect(created?.steps).toHaveLength(MAX_CASE_STEPS);
    expect(created?.steps?.[0]?.expected).toHaveLength(2000);
    expect(warnings).toEqual([
      `Dropped the case tags beyond the first ${MAX_CASE_TAGS}`,
      'Ignored a case field whose name is longer than 200 characters',
      'Ignored a case field whose name repeats another once trimmed and compared ignoring case',
      `Dropped the case fields beyond the first ${MAX_CASE_FIELDS}`,
      'Dropped a case step without an action',
      `Dropped the case steps beyond the first ${MAX_CASE_STEPS}`,
    ]);
  });

  it('ignores parts of the wrong type, and sends no case when nothing is left', () => {
    const { entry, warnings } = convert({
      case: JSON.parse(
        '{"description":7,"tags":"smoke","fields":["a"],"steps":{"action":"x"}}',
      ) as NonNullable<TestResultInput['case']>,
    });
    expect(entry).not.toHaveProperty('case');
    expect(warnings).toEqual([
      'Ignored a case description that is not a string',
      'Ignored case tags that are not a list of strings',
      'Ignored case fields that are not an object',
      'Ignored case steps that are not a list',
    ]);
    expect(
      convert({ case: 'x' as unknown as NonNullable<TestResultInput['case']> }).warnings,
    ).toEqual(['Ignored a case that is not an object']);
  });
});

describe('toReportEntry links', () => {
  it('sends the links in order, url and name trimmed, a blank name left out', () => {
    const { entry, warnings } = convert({
      links: [
        { url: ' https://jira.example.com/browse/PRB-7 ', name: ' PRB-7 ' },
        { url: 'http://ci.example.com/build/12' },
        { url: 'https://docs.example.com', name: '  ' },
      ],
    });
    expect(entry.links).toEqual([
      { url: 'https://jira.example.com/browse/PRB-7', name: 'PRB-7' },
      { url: 'http://ci.example.com/build/12' },
      { url: 'https://docs.example.com' },
    ]);
    expect(warnings).toEqual([]);
  });

  it('drops, with a warning, the links the server refuses: other schemes, no `//`, relative or too long URLs', () => {
    const long = `https://example.com/${'a'.repeat(MAX_LINK_URL_LENGTH)}`;
    const { entry, warnings } = convert({
      links: [
        { url: 'javascript:alert(1)' },
        { url: 'data:text/html,x' },
        { url: 'file:///etc/passwd' },
        { url: 'ftp://example.com/x' },
        { url: 'http:example.com' },
        { url: 'https:/ci.example.com/x' },
        { url: '/browse/PRB-7' },
        { url: long },
        { url: 'https://example.com/kept' },
      ],
    });
    expect(entry.links).toEqual([{ url: 'https://example.com/kept' }]);
    expect(warnings).toEqual([
      `Dropped a link without an absolute http(s) URL of at most ${MAX_LINK_URL_LENGTH} characters`,
    ]);
  });

  it('drops links of the wrong shape with a warning, never throwing', () => {
    const links = [
      'https://example.com',
      null,
      { url: 42 },
      { url: 'https://example.com/a', name: 7 },
      { url: 'https://example.com/b', name: 'b' },
    ] as unknown as NonNullable<TestResultInput['links']>;
    const { entry, warnings } = convert({ links });
    expect(entry.links).toEqual([{ url: 'https://example.com/b', name: 'b' }]);
    expect(warnings).toEqual([
      `Dropped a link without an absolute http(s) URL of at most ${MAX_LINK_URL_LENGTH} characters`,
      'Dropped a link whose name is not a string',
    ]);
    const notAList = 'https://x.io' as unknown as NonNullable<TestResultInput['links']>;
    const ignored = convert({ links: notAList });
    expect(ignored.entry).not.toHaveProperty('links');
    expect(ignored.warnings).toEqual(['Ignored links that are not a list']);
  });

  it('keeps the first 20 links and cuts a long name, with warnings', () => {
    const links = Array.from({ length: MAX_LINKS_PER_RESULT + 3 }, (_, index) => ({
      url: `https://example.com/${index}`,
      name: index === 0 ? 'n'.repeat(MAX_LINK_NAME_LENGTH + 5) : `link ${index}`,
    }));
    const { entry, warnings } = convert({ links });
    expect(entry.links).toHaveLength(MAX_LINKS_PER_RESULT);
    expect(entry.links?.[MAX_LINKS_PER_RESULT - 1]?.url).toBe(
      `https://example.com/${MAX_LINKS_PER_RESULT - 1}`,
    );
    expect(entry.links?.[0]?.name).toHaveLength(MAX_LINK_NAME_LENGTH);
    expect(warnings).toEqual([
      `Truncated a link name longer than ${MAX_LINK_NAME_LENGTH} characters`,
      `Dropped the links beyond the first ${MAX_LINKS_PER_RESULT} of a result`,
    ]);
  });

  it('sends no links when none is left', () => {
    expect(convert({ links: [] }).entry).not.toHaveProperty('links');
    expect(convert({ links: [{ url: 'mailto:a@example.com' }] }).entry).not.toHaveProperty('links');
  });
});

describe('entryTotals', () => {
  it('counts the result steps of every level, the case steps and the case tags of an entry', () => {
    const { entry } = convert({
      steps: [{ action: 'a', status: 'passed', steps: [{ action: 'b', status: 'passed' }] }],
      case: { tags: ['x', 'y', 'z'], steps: [{ action: 'one' }] },
    });
    expect(entryTotals(entry)).toEqual({ resultSteps: 2, caseSteps: 1, caseTags: 3 });
    expect(entryTotals(convert({}).entry)).toEqual({ resultSteps: 0, caseSteps: 0, caseTags: 0 });
  });
});
