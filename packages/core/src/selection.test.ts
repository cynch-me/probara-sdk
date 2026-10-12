/**
 * The run selection matcher (`runCasesOnly`): which tests belong to the cases of a Probara run, by the case ids their
 * names hold and by their automation keys.
 */
import { describe, expect, it } from 'vitest';
import { createRunSelector, type RunCases } from './selection.js';

const CART_KEY = 'tests/cart.test.ts > cart > adds an item';

const RUN: RunCases = { keys: [CART_KEY], caseIds: ['SHOP-1', 'SHOP-7'] };

describe('createRunSelector', () => {
  const selects = createRunSelector(RUN);

  it('selects a test whose names hold a case id of the run, whatever its key', () => {
    expect(selects({ ids: ['SHOP-7'], key: 'tests/other.test.ts > other > runs' })).toBe(true);
  });

  it('selects a test whose automation key is the key of a case of the run, with no case id in its names', () => {
    expect(selects({ ids: [], key: CART_KEY })).toBe(true);
  });

  it('selects no test whose names hold no case id of the run and whose key is none of the run', () => {
    expect(selects({ ids: ['SHOP-2'], key: 'tests/cart.test.ts > cart > empties' })).toBe(false);
  });

  it('selects a test with no automation key by its case id alone', () => {
    expect(selects({ ids: [] })).toBe(false);
    expect(selects({ ids: ['SHOP-1'] })).toBe(true);
  });

  it('selects nothing in a run with no cases', () => {
    const none = createRunSelector({ keys: [], caseIds: [] });
    expect(none({ ids: ['SHOP-1'], key: CART_KEY })).toBe(false);
  });

  it('matches exactly: a case id that extends a case of the run, or a key with more text, is no match', () => {
    expect(selects({ ids: ['SHOP-70'] })).toBe(false);
    expect(selects({ ids: [], key: `${CART_KEY} > extra` })).toBe(false);
  });
});
