/**
 * The run selection of a Vitest run, as the worker and the reporter read it: the value the reporter provides, and the
 * rule that decides a test (its file, its describes and its title) with it.
 */
import { describe, expect, it } from 'vitest';
import {
  createTestSelector,
  selectionOf,
  selectionValue,
  type RunCaseSelection,
} from './run-selection.js';

const ROOT = '/work/shop';
const FILE = `${ROOT}/tests/checkout.test.ts`;
const SELECTION: RunCaseSelection = {
  run: '01J9Z3K4M5N6P7Q8R9S0T1V2W3',
  keys: ['tests/checkout.test.ts > checkout > applies the coupon'],
  caseIds: ['SHOP-1', 'SHOP-3'],
  projectCodes: ['SHOP'],
  keyIncludesFile: true,
  rootDir: ROOT,
};

describe('selectionOf and selectionValue', () => {
  it('reads back the selection the reporter provides', () => {
    expect(selectionOf(selectionValue(SELECTION))).toEqual(SELECTION);
  });

  it('reads no selection from a missing value, an empty one, or one that is not a selection', () => {
    expect(selectionOf(undefined)).toBeUndefined();
    expect(selectionOf('')).toBeUndefined();
    expect(selectionOf('{"run":1}')).toBeUndefined();
    expect(selectionOf('not json')).toBeUndefined();
  });
});

describe('createTestSelector', () => {
  const selects = createTestSelector(SELECTION);

  it('selects a test by a case id in its describes or in its title', () => {
    expect(selects(FILE, ['SHOP-3 refunds'], 'issues the refund')).toBe(true);
    expect(selects(FILE, [], 'SHOP-1 pays with a card')).toBe(true);
  });

  it('selects a test by the automation key of a case, the key the reporter sends it with', () => {
    expect(selects(FILE, ['checkout'], 'applies the coupon')).toBe(true);
  });

  it('selects no test of another case, nor one whose key names another file', () => {
    expect(selects(FILE, ['checkout'], 'is not in the run')).toBe(false);
    expect(selects(`${ROOT}/tests/other.test.ts`, ['checkout'], 'applies the coupon')).toBe(false);
  });
});
