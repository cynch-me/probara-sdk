import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixturePath } from '../../test/fixtures.js';
import { parseFeature } from './parse.js';
import type { GherkinFeature } from './features.js';

const PAY = fixturePath('cucumber', 'source', 'features', 'checkout', 'pay.feature');

function featureOfFile(path: string): GherkinFeature {
  const parsed = parseFeature(readFileSync(path, 'utf8'), path);
  if (!parsed.ok || parsed.feature === undefined) throw new Error('expected a feature');
  return parsed.feature;
}

function featureOfText(text: string): GherkinFeature {
  const parsed = parseFeature(text, 'inline.feature');
  if (!parsed.ok || parsed.feature === undefined) throw new Error('expected a feature');
  return parsed.feature;
}

function scenarioNamed(feature: GherkinFeature, name: string) {
  const scenario = feature.scenarios.find((item) => item.name === name);
  if (scenario === undefined) throw new Error(`no scenario named ${name}`);
  return scenario;
}

describe('the feature of a file', () => {
  it('keeps the name, line, description and tags of the Feature, without the @ of each tag', () => {
    expect(featureOfFile(PAY)).toMatchObject({
      name: 'Checkout',
      line: 2,
      description: 'Customers pay for their cart.',
      tags: ['checkout'],
    });
  });

  it('maps a plain scenario with its line, tags, Background and steps, keywords trimmed', () => {
    expect(scenarioNamed(featureOfFile(PAY), 'Pay with the saved card')).toEqual({
      name: 'Pay with the saved card',
      line: 9,
      description: '',
      tags: ['smoke'],
      background: [{ keyword: 'Given', text: 'a cart with a book', line: 6 }],
      steps: [
        { keyword: 'When', text: 'the customer pays with the saved card', line: 10 },
        { keyword: 'Then', text: 'the order is confirmed', line: 11 },
      ],
      examples: [],
    });
  });

  it('keeps a Scenario Outline once, with its Examples header and rows, each row on its line', () => {
    expect(scenarioNamed(featureOfFile(PAY), 'Pay with <method>')).toMatchObject({
      name: 'Pay with <method>',
      line: 13,
      steps: [
        { keyword: 'When', text: 'the customer pays with <method>', line: 14 },
        { keyword: 'Then', text: 'the order is confirmed for <amount>', line: 15 },
      ],
      examples: [
        {
          name: 'Cards',
          header: ['method', 'amount'],
          rows: [
            { line: 19, cells: ['visa', '12'] },
            { line: 20, cells: ['paypal', '30'] },
          ],
        },
      ],
    });
  });

  it('keeps a Doc String as its content and a Data Table as its rows', () => {
    expect(scenarioNamed(featureOfFile(PAY), 'Send the receipt').steps).toEqual([
      {
        keyword: 'When',
        text: 'the customer sends the receipt:',
        line: 23,
        docString: 'Thank you for the order.',
      },
      {
        keyword: 'And',
        text: 'the receipt table is:',
        line: 27,
        table: [
          ['item', 'price'],
          ['book', '12'],
        ],
      },
      { keyword: 'Then', text: 'the receipt is sent', line: 30 },
    ]);
  });

  it('keeps the Background of a Rule after the feature Background, and the name of the Rule', () => {
    expect(scenarioNamed(featureOfFile(PAY), 'Refund a paid order')).toMatchObject({
      line: 36,
      rule: { name: 'Refunds', tags: [] },
      background: [
        { keyword: 'Given', text: 'a cart with a book', line: 6 },
        { keyword: 'Given', text: 'a paid order', line: 34 },
      ],
    });
  });

  it('keeps the tags of a Rule, without their @', () => {
    const feature = featureOfText(
      'Feature: Shop\n  @policy\n  Rule: Refunds\n    Scenario: Refund\n      Given an order\n',
    );
    expect(scenarioNamed(feature, 'Refund').rule).toEqual({ name: 'Refunds', tags: ['policy'] });
  });
});
