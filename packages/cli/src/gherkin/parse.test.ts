import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixturePath } from '../../test/fixtures.js';
import { parseFeature } from './parse.js';

const PAY = fixturePath('cucumber', 'source', 'features', 'checkout', 'pay.feature');

describe('parseFeature', () => {
  it('reads the Feature of a file as written', () => {
    const parsed = parseFeature(readFileSync(PAY, 'utf8'), 'features/checkout/pay.feature');
    expect(parsed).toMatchObject({ ok: true, feature: { name: 'Checkout' } });
  });

  it('reads a file with no Feature as no feature, not as an error', () => {
    expect(parseFeature('# just a comment\n', 'empty.feature')).toEqual({
      ok: true,
      feature: undefined,
    });
  });

  it('names a syntax error with its path and line, and no duplicate location in the message', () => {
    const parsed = parseFeature(
      'Feature: Checkout\n\n  Scenario: Pay\n    Given a cart\n  nonsense here\n',
      'features/pay.feature',
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toMatchObject({ path: 'features/pay.feature', line: 5 });
    expect(parsed.problems[0]?.message).not.toMatch(/^\(/);
    expect(parsed.problems[0]?.message.length).toBeGreaterThan(0);
  });
});
