import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixturePath } from '../../test/fixtures.js';
import { parseFeature } from './parse.js';
import type { GherkinFeature } from './features.js';
import {
  automationKeyOf,
  escapeGlob,
  findDuplicateKeys,
  pathOf,
  scopeOf,
  syncFeatureOf,
  syncLimitProblems,
} from './sync.js';

const SOURCE = fixturePath('cucumber', 'source');
const PAY_PATH = 'features/checkout/pay.feature';

function featureOfFile(path: string): GherkinFeature {
  const parsed = parseFeature(readFileSync(join(SOURCE, path), 'utf8'), path);
  if (!parsed.ok || parsed.feature === undefined) throw new Error('expected a feature');
  return parsed.feature;
}

describe('automationKeyOf', () => {
  it('builds <path> > <Feature> > <Scenario>, with the Rule left out of it', () => {
    expect(automationKeyOf(PAY_PATH, 'Checkout', 'Refund a paid order', SOURCE)).toBe(
      'features/checkout/pay.feature > Checkout > Refund a paid order',
    );
  });
});

describe('syncFeatureOf', () => {
  it('sends the feature with its scenarios, each keyed by its names, and no parameters for an outline', () => {
    const feature = syncFeatureOf(PAY_PATH, featureOfFile(PAY_PATH), { rootDir: SOURCE });

    expect(feature).toMatchObject({
      path: PAY_PATH,
      name: 'Checkout',
      description: 'Customers pay for their cart.',
      tags: ['checkout'],
    });
    const byName = new Map(feature.scenarios.map((scenario) => [scenario.name, scenario]));
    expect(byName.get('Pay with <method>')).toEqual({
      automationKey: 'features/checkout/pay.feature > Checkout > Pay with <method>',
      name: 'Pay with <method>',
      line: 13,
      tags: [],
      background: [{ keyword: 'Given', text: 'a cart with a book' }],
      steps: [
        { keyword: 'When', text: 'the customer pays with <method>' },
        { keyword: 'Then', text: 'the order is confirmed for <amount>' },
      ],
      examples: [
        {
          name: 'Cards',
          header: ['method', 'amount'],
          rows: [
            ['visa', '12'],
            ['paypal', '30'],
          ],
        },
      ],
    });
  });

  it('sends a Doc String as the argument of its step, and a Data Table as lines of pipes', () => {
    const feature = syncFeatureOf(PAY_PATH, featureOfFile(PAY_PATH), { rootDir: SOURCE });
    const receipt = feature.scenarios.find((scenario) => scenario.name === 'Send the receipt');
    expect(receipt?.steps).toEqual([
      {
        keyword: 'When',
        text: 'the customer sends the receipt:',
        argument: 'Thank you for the order.',
      },
      {
        keyword: 'And',
        text: 'the receipt table is:',
        argument: '| item | price |\n| book | 12 |',
      },
      { keyword: 'Then', text: 'the receipt is sent' },
    ]);
    expect(receipt?.background).toEqual([{ keyword: 'Given', text: 'a cart with a book' }]);
  });

  it('sends the Background of the feature then of the Rule, and the Rule name, under the same key', () => {
    const feature = syncFeatureOf(PAY_PATH, featureOfFile(PAY_PATH), { rootDir: SOURCE });
    expect(feature.scenarios.find((scenario) => scenario.name === 'Refund a paid order')).toEqual({
      automationKey: 'features/checkout/pay.feature > Checkout > Refund a paid order',
      name: 'Refund a paid order',
      line: 36,
      tags: [],
      rule: { name: 'Refunds', tags: [] },
      background: [
        { keyword: 'Given', text: 'a cart with a book' },
        { keyword: 'Given', text: 'a paid order' },
      ],
      steps: [
        { keyword: 'When', text: 'the customer asks for a refund' },
        { keyword: 'Then', text: 'the refund is issued' },
      ],
    });
  });

  it('sends the link of each scenario only when one is given', () => {
    const feature = syncFeatureOf(
      'features/cart/cart.feature',
      featureOfFile('features/cart/cart.feature'),
      {
        rootDir: SOURCE,
        urlOf: (line) => `https://example.test/cart.feature#L${line}`,
      },
    );
    expect(feature.scenarios[0]).toMatchObject({ url: 'https://example.test/cart.feature#L6' });
  });
});

describe('findDuplicateKeys', () => {
  it('names both scenarios, by path and line, of every key two of them share', () => {
    expect(
      findDuplicateKeys([
        { path: 'features/x.feature', line: 3, key: 'k' },
        { path: 'features/x.feature', line: 9, key: 'k' },
        { path: 'features/x.feature', line: 12, key: 'other' },
      ]),
    ).toEqual([
      'features/x.feature:3 and features/x.feature:9 have the same automation key "k": give one of them another name',
    ]);
  });

  it('finds nothing when every key is unique', () => {
    expect(findDuplicateKeys([{ path: 'a.feature', line: 1, key: 'a' }])).toEqual([]);
  });
});

describe('scopeOf', () => {
  it('turns a directory into its feature files beneath it', async () => {
    await expect(scopeOf(['features'], SOURCE, SOURCE)).resolves.toEqual(['features/**/*.feature']);
  });

  it('keeps a glob as it is when the working directory is the root', async () => {
    await expect(scopeOf(['features/**/*.feature'], SOURCE, SOURCE)).resolves.toEqual([
      'features/**/*.feature',
    ]);
  });

  it('expresses a file as the file itself, escaped for a glob', async () => {
    await expect(scopeOf([PAY_PATH], SOURCE, SOURCE)).resolves.toEqual([PAY_PATH]);
  });

  it('expresses arguments relative to the root directory when the working directory is below it', async () => {
    const features = join(SOURCE, 'features');
    await expect(scopeOf(['checkout'], features, SOURCE)).resolves.toEqual([
      'features/checkout/**/*.feature',
    ]);
    await expect(scopeOf(['*.feature'], join(features, 'checkout'), SOURCE)).resolves.toEqual([
      'features/checkout/*.feature',
    ]);
    await expect(
      scopeOf(['../cart/cart.feature'], join(features, 'checkout'), SOURCE),
    ).resolves.toEqual(['features/cart/cart.feature']);
  });

  it('escapes the glob characters of a file name', () => {
    expect(escapeGlob('features/[id]/a*b.feature')).toBe('features/\\[id\\]/a\\*b.feature');
  });
});

describe('pathOf', () => {
  it('is the POSIX path of a file below the root directory', () => {
    expect(pathOf(join(SOURCE, 'features', 'cart', 'cart.feature'), SOURCE)).toBe(
      'features/cart/cart.feature',
    );
  });

  it('is undefined for a file outside the root directory', () => {
    expect(pathOf('/elsewhere/checkout.feature', SOURCE)).toBeUndefined();
  });
});

describe('syncLimitProblems', () => {
  it('refuses more than 1,000 scenarios, telling the user to sync each folder', () => {
    expect(syncLimitProblems({ scenarios: 1001, scopeGlobs: 1 })).toEqual([
      'a sync carries at most 1,000 scenarios, this one has 1,001: sync each folder with its own glob',
    ]);
  });

  it('refuses more than 20 scope globs', () => {
    expect(syncLimitProblems({ scenarios: 1, scopeGlobs: 21 })).toEqual([
      'a sync carries at most 20 globs, this one has 21: sync each folder with its own glob',
    ]);
  });

  it('accepts a sync at both limits', () => {
    expect(syncLimitProblems({ scenarios: 1000, scopeGlobs: 20 })).toEqual([]);
  });
});
