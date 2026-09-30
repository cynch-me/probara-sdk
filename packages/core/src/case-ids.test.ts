import { describe, expect, it } from 'vitest';
import {
  extractCaseIds,
  extractTitlePathCaseIds,
  parseCaseDisplayId,
  parseCaseIdList,
} from './case-ids.js';

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

  it.each([
    ['applies a coupon (@PRB-8)', 'applies a coupon'],
    ['logs in [@PRB-12]', 'logs in'],
    ['logs in [@ @PRB-12]', 'logs in'],
    ['logs in ([@PRB-12]) twice', 'logs in twice'],
    ['[@PRB-12, @PRB-13] logs in', 'logs in'],
    ['logs in [PRB-12 @PRB-13]', 'logs in'],
    ['logs in (@PRB-12 , @PRB-13 ,) twice', 'logs in twice'],
  ])('removes the brackets the ids of %j leave empty', (name, text) => {
    expect(extractCaseIds(name, 'PRB').text).toBe(text);
  });

  it.each([
    ['logs in (see PRB-12)', 'logs in (see)'],
    ['calls fn() PRB-12', 'calls fn()'],
    ['PRB-12 [] stays', '[] stays'],
    ['logs in (@PRB-12]', 'logs in (]'],
  ])('keeps the brackets of %j that hold text or were empty already', (name, text) => {
    expect(extractCaseIds(name, 'PRB').text).toBe(text);
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

describe('extractTitlePathCaseIds', () => {
  it('removes the ids of every segment and collects them in order, once each', () => {
    expect(extractTitlePathCaseIds(['Cart PRB-1', 'PRB-2 adds an item (PRB-1)'], 'PRB')).toEqual({
      titlePath: ['Cart', 'adds an item'],
      ids: ['PRB-1', 'PRB-2'],
    });
  });

  it('drops a segment that held nothing but ids', () => {
    expect(extractTitlePathCaseIds(['[PRB-3]', 'logs in'], 'PRB')).toEqual({
      titlePath: ['logs in'],
      ids: ['PRB-3'],
    });
  });

  it('keeps the segments as they were when nothing but ids is left', () => {
    expect(extractTitlePathCaseIds(['PRB-9'], 'PRB')).toEqual({
      titlePath: ['PRB-9'],
      ids: ['PRB-9'],
    });
    expect(extractTitlePathCaseIds(['PRB-9', '(PRB-10)'], 'PRB')).toEqual({
      titlePath: ['PRB-9', '(PRB-10)'],
      ids: ['PRB-9', 'PRB-10'],
    });
  });

  it('keeps the segments without a project code', () => {
    expect(extractTitlePathCaseIds(['PRB-1 logs in'], undefined)).toEqual({
      titlePath: ['PRB-1 logs in'],
      ids: [],
    });
  });
});

describe('parseCaseDisplayId', () => {
  it.each([
    ['PRB-12', { projectCode: 'PRB', number: 12 }],
    ['WEB-3', { projectCode: 'WEB', number: 3 }],
    ['A1B2-1000', { projectCode: 'A1B2', number: 1000 }],
  ])('reads the project code and number of %j', (id, parsed) => {
    expect(parseCaseDisplayId(id)).toEqual(parsed);
  });

  it.each(['prb-12', 'PRB_12', 'PRB-0', 'PRB-012', ' PRB-12', 'PRB-12 ', '1PRB-2', 'PRB', ''])(
    'finds no display id in %j',
    (id) => {
      expect(parseCaseDisplayId(id)).toBeUndefined();
    },
  );

  it('keeps the well-formed ids of a list', () => {
    const ids = parseCaseIdList('PRB-12, WEB-3, not an id, prb-4');
    expect(ids.filter((id) => parseCaseDisplayId(id) !== undefined)).toEqual(['PRB-12', 'WEB-3']);
  });
});
