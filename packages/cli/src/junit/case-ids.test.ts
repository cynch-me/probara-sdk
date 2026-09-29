import { describe, expect, it } from 'vitest';
import { extractCaseIds, parseCaseIdList } from './case-ids.js';

describe('extractCaseIds', () => {
  it.each([
    ['PRB-12 logs in with a valid password', 'logs in with a valid password'],
    ['logs in PRB-12', 'logs in'],
    ['login PRB-12 logs in', 'login logs in'],
    ['[PRB-12] logs in', 'logs in'],
    ['logs in (PRB-12)', 'logs in'],
    ['@PRB-12 logs in', 'logs in'],
    ['PRB-12: logs in', 'logs in'],
    ['logs in - PRB-12 - twice', 'logs in - twice'],
    [' [PRB-13] top-level test outside any describe', 'top-level test outside any describe'],
    ['PRB-12_logs_in_with_a_valid_password', 'logs_in_with_a_valid_password'],
    ['test_PRB_12_logs_in', 'test_logs_in'],
    [
      'test_unicode_parameter_ids[PRB-14 accepts caf\\xe9]',
      'test_unicode_parameter_ids[accepts caf\\xe9]',
    ],
  ])('finds the id in %j and removes it', (name, text) => {
    const result = extractCaseIds(name, 'PRB');
    expect(result.text).toBe(text);
    expect(result.ids).toHaveLength(1);
  });

  it('normalizes the underscore form to the display id', () => {
    expect(extractCaseIds('test_PRB_12_logs_in', 'PRB').ids).toEqual(['PRB-12']);
    expect(extractCaseIds('[PRB-14] x', 'PRB').ids).toEqual(['PRB-14']);
  });

  it.each([
    'XPRB-12 is part of a longer code',
    'PRB-123a has a letter after the number',
    'PRB-12x has a letter after the number',
    '1PRB-12 has a digit before',
    'prb-12 is another case',
    'PRB12 has no separator',
    'PRB- 12 has a gap',
    'user@PRB-12 is not a mention',
  ])('ignores %j', (name) => {
    expect(extractCaseIds(name, 'PRB')).toEqual({ text: name, ids: [] });
  });

  it('keeps the whole number and never a prefix of it', () => {
    expect(extractCaseIds('PRB-123 logs in', 'PRB').ids).toEqual(['PRB-123']);
  });

  it('ignores the ids of other projects', () => {
    expect(extractCaseIds('SHOP-12 logs in', 'PRB')).toEqual({ text: 'SHOP-12 logs in', ids: [] });
    expect(extractCaseIds('SHOP-12 PRB-3 logs in', 'SHOP')).toEqual({
      text: 'PRB-3 logs in',
      ids: ['SHOP-12'],
    });
  });

  it('finds several ids in order, once each', () => {
    expect(extractCaseIds('[PRB-12, PRB-13] logs in PRB-12 (PRB-2)', 'PRB')).toEqual({
      text: 'logs in',
      ids: ['PRB-12', 'PRB-13', 'PRB-2'],
    });
  });

  it('treats a project code with regular expression characters literally', () => {
    expect(extractCaseIds('A.B-1 x', 'A.B')).toEqual({ text: 'x', ids: ['A.B-1'] });
    expect(extractCaseIds('AXB-1 x', 'A.B').ids).toEqual([]);
  });

  it('parses nothing without a project code', () => {
    expect(extractCaseIds('PRB-12 logs in', undefined)).toEqual({
      text: 'PRB-12 logs in',
      ids: [],
    });
  });
});

describe('parseCaseIdList', () => {
  it('splits a comma-separated list, trimming and dropping blanks and repeats', () => {
    expect(parseCaseIdList(' PRB-13, PRB-14 ,,PRB-13 ')).toEqual(['PRB-13', 'PRB-14']);
    expect(parseCaseIdList('  ')).toEqual([]);
  });
});
