import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixturePath } from '../../test/fixtures.js';
import { cucumberFeaturesOf, resultsOfCucumber } from './json.js';

const SOURCE = fixturePath('cucumber', 'source');
const REPORT = fixturePath('cucumber', 'cucumber.json');

/** A feature file that is not there. */
const absent = (): Promise<undefined> => Promise.resolve(undefined);

/** The feature files of the fixture project, as the import reads them: `undefined` when absent. */
async function readFeature(path: string): Promise<string | undefined> {
  try {
    return await readFile(join(SOURCE, path), 'utf8');
  } catch {
    return undefined;
  }
}

function featuresOf(text: string) {
  const read = cucumberFeaturesOf(text);
  if (!read.ok) throw new Error(read.error);
  return read.features;
}

/** A one-scenario report, for the cases the real output does not show. */
function oneScenario(element: Record<string, unknown>, uri = 'features/x.feature') {
  return JSON.stringify([
    {
      uri,
      name: 'Shop',
      keyword: 'Feature',
      line: 1,
      elements: [
        { type: 'scenario', keyword: 'Scenario', name: 'Buy', line: 3, steps: [], ...element },
      ],
    },
  ]);
}

describe('cucumberFeaturesOf', () => {
  it('reads the features of the Cucumber JSON fixture', () => {
    const features = featuresOf(readFileSync(REPORT, 'utf8'));
    expect(features.map((feature) => feature.uri)).toEqual([
      'features/cart/cart.feature',
      'features/checkout/pay.feature',
    ]);
  });

  it('refuses a document that is not an array of features', () => {
    expect(cucumberFeaturesOf('{"features": []}')).toEqual({
      ok: false,
      error: 'is not a Cucumber JSON report: expected an array of features',
    });
  });

  it('refuses text that is not JSON', () => {
    expect(cucumberFeaturesOf('[ nope')).toMatchObject({ ok: false });
  });
});

describe('resultsOfCucumber with the fixture', () => {
  async function reading() {
    return resultsOfCucumber(featuresOf(readFileSync(REPORT, 'utf8')), {
      rootDir: SOURCE,
      readFeature,
    });
  }

  it('sends one result per scenario, outline rows included, with the status of each', async () => {
    const { results, errors } = await reading();
    expect(errors).toEqual([]);
    expect(results.map((result) => [result.title, result.status])).toEqual([
      ['Add a book', 'passed'],
      ['Pay with the saved card', 'passed'],
      ['Pay with <method>', 'passed'],
      ['Pay with <method>', 'passed'],
      ['Send the receipt', 'passed'],
      ['Refund a paid order', 'passed'],
      ['A declined card fails', 'failed'],
      ['A page with no step definition', 'skipped'],
      ['A step that is still pending', 'skipped'],
      ['A step that matches two definitions', 'failed'],
    ]);
  });

  it('keys each result by its feature and scenario names, never by the Rule', async () => {
    const { results } = await reading();
    const refund = results.find((result) => result.title === 'Refund a paid order');
    expect(refund?.identity).toEqual({
      file: 'features/checkout/pay.feature',
      titlePath: ['Checkout', 'Refund a paid order'],
    });
    expect(refund?.suitePath).toEqual(['features', 'checkout', 'Checkout', 'Refunds']);
  });

  it('keys an outline row by its written name, with the Examples values as its parameters', async () => {
    const { results } = await reading();
    const rows = results.filter((result) => result.title === 'Pay with <method>');
    expect(rows.map((row) => row.identity)).toEqual([
      { file: 'features/checkout/pay.feature', titlePath: ['Checkout', 'Pay with <method>'] },
      { file: 'features/checkout/pay.feature', titlePath: ['Checkout', 'Pay with <method>'] },
    ]);
    expect(rows.map((row) => row.parameters)).toEqual([
      { method: 'visa', amount: '12' },
      { method: 'paypal', amount: '30' },
    ]);
  });

  it('nests the Background steps under one Background step, then the scenario steps, keywords trimmed', async () => {
    const { results } = await reading();
    const plain = results.find((result) => result.title === 'Pay with the saved card');
    expect(plain?.steps).toMatchObject([
      {
        action: 'Background',
        status: 'passed',
        steps: [{ action: 'a cart with a book', keyword: 'Given', status: 'passed' }],
      },
      { action: 'the customer pays with the saved card', keyword: 'When', status: 'passed' },
      { action: 'the order is confirmed', keyword: 'Then', status: 'passed' },
    ]);
  });

  it('sends a Doc String and a Data Table as the data of their step', async () => {
    const { results } = await reading();
    const receipt = results.find((result) => result.title === 'Send the receipt');
    const steps = receipt?.steps ?? [];
    expect(steps.find((step) => step.action === 'the customer sends the receipt:')).toMatchObject({
      data: 'Thank you for the order.',
    });
    expect(steps.find((step) => step.action === 'the receipt table is:')).toMatchObject({
      data: '| item | price |\n| book | 12 |',
    });
  });

  it('fails a scenario on its failing step, keeps the error, and skips the steps after it', async () => {
    const { results } = await reading();
    const declined = results.find((result) => result.title === 'A declined card fails');
    expect(declined?.status).toBe('failed');
    expect(JSON.stringify(declined?.error)).toContain('The card was declined');
    expect(declined?.steps?.map((step) => [step.action, step.status])).toEqual([
      ['Background', 'passed'],
      ['the customer pays with a declined card', 'failed'],
      ['the order is confirmed', 'skipped'],
    ]);
  });

  it('maps an undefined and a pending step to skipped, and an ambiguous one to failed with a reason', async () => {
    const { results } = await reading();
    const undefinedStep = results.find(
      (result) => result.title === 'A page with no step definition',
    );
    expect(undefinedStep?.status).toBe('skipped');
    const pending = results.find((result) => result.title === 'A step that is still pending');
    expect(pending?.status).toBe('skipped');
    const ambiguous = results.find(
      (result) => result.title === 'A step that matches two definitions',
    );
    expect(ambiguous?.status).toBe('failed');
    expect(JSON.stringify(ambiguous?.error)).toContain('more than one step definition');
  });

  it('leaves out the hidden hook steps of the report', async () => {
    const { results } = await reading();
    for (const result of results) {
      for (const step of result.steps ?? []) {
        expect(step.action).not.toBe('');
        expect(step.action).not.toBe('Before');
      }
    }
  });

  it('sends the durations in milliseconds, rounded from nanoseconds', async () => {
    const { results } = await reading();
    const plain = results.find((result) => result.title === 'Pay with the saved card');
    expect(Number.isInteger(plain?.durationMs)).toBe(true);
    expect(plain?.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('resultsOfCucumber', () => {
  it('rounds nanoseconds to whole milliseconds', async () => {
    const report = oneScenario({
      steps: [
        {
          keyword: 'Given ',
          name: 'a book',
          line: 4,
          result: { status: 'passed', duration: 1_499_999 },
        },
      ],
    });
    const { results } = await resultsOfCucumber(featuresOf(report), {
      rootDir: SOURCE,
      readFeature: absent,
    });
    expect(results[0]?.steps?.[0]?.durationMs).toBe(1);
    expect(results[0]?.durationMs).toBe(1);
  });

  it('fails a scenario on a failed hidden hook, whose error becomes the result error', async () => {
    const report = oneScenario({
      steps: [
        {
          keyword: 'After',
          hidden: true,
          result: { status: 'failed', duration: 5, error_message: 'hook broke' },
        },
        { keyword: 'Given ', name: 'a book', line: 4, result: { status: 'passed', duration: 1 } },
      ],
    });
    const { results } = await resultsOfCucumber(featuresOf(report), {
      rootDir: SOURCE,
      readFeature: absent,
    });
    expect(results[0]?.status).toBe('failed');
    expect(JSON.stringify(results[0]?.error)).toContain('hook broke');
    expect(results[0]?.steps?.map((step) => step.action)).toEqual(['a book']);
  });

  it('keys a scenario by the report names when its feature file is not there, and says so once', async () => {
    const report = oneScenario(
      {
        steps: [
          { keyword: 'Given ', name: 'a book', line: 4, result: { status: 'passed', duration: 1 } },
        ],
      },
      'features/missing.feature',
    );
    const { results, notes } = await resultsOfCucumber(featuresOf(report), {
      rootDir: SOURCE,
      readFeature: absent,
    });
    expect(results[0]?.identity).toEqual({
      file: 'features/missing.feature',
      titlePath: ['Shop', 'Buy'],
    });
    expect(notes).toEqual([
      'features/missing.feature was not found: its scenarios are keyed by the names in the report',
    ]);
  });

  it('reads a file: URI as the path of a feature under the root', async () => {
    const report = oneScenario(
      { steps: [] },
      `file://${join(SOURCE, 'features', 'cart', 'cart.feature')}`,
    );
    const { results } = await resultsOfCucumber(featuresOf(report), {
      rootDir: SOURCE,
      readFeature: (path) =>
        Promise.resolve(
          path === 'features/cart/cart.feature'
            ? readFileSync(join(SOURCE, path), 'utf8')
            : undefined,
        ),
    });
    expect(results[0]?.identity.file).toBe('features/cart/cart.feature');
    expect(results[0]?.suitePath).toEqual(['features', 'cart', 'Shop']);
  });

  it('reports a feature file that does not parse as an error, and sends nothing from it', async () => {
    const report = oneScenario({ steps: [] }, 'features/broken.feature');
    const { results, errors } = await resultsOfCucumber(featuresOf(report), {
      rootDir: SOURCE,
      // A language Gherkin does not know: the file cannot be read.
      readFeature: () => Promise.resolve('# language: xx\nFeature: Shop\n'),
    });
    expect(results).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^features\/broken\.feature:\d+/);
  });

  it('falls back to the report names, with a warning, when a scenario is not at its line in the file', async () => {
    const report = oneScenario({ line: 999, steps: [] }, 'features/cart/cart.feature');
    const { results, warnings } = await resultsOfCucumber(featuresOf(report), {
      rootDir: SOURCE,
      readFeature,
    });
    expect(results[0]?.identity.titlePath).toEqual(['Shop', 'Buy']);
    expect(warnings).toEqual([
      'features/cart/cart.feature: no scenario is at line 999: its key is built from the names in the report',
    ]);
  });

  it('skips a scenario without a name, with a warning', async () => {
    const report = oneScenario({ name: '', steps: [] });
    const { results, warnings } = await resultsOfCucumber(featuresOf(report), {
      rootDir: SOURCE,
      readFeature: absent,
    });
    expect(results).toEqual([]);
    expect(warnings).toEqual(['features/x.feature: skipped a scenario without a name']);
  });
});
