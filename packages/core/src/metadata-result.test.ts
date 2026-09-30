import { describe, expect, it } from 'vitest';
import { readMetadataMessages } from './metadata.js';
import { caseOf, linkedCaseIds, metadataResultFields } from './metadata-result.js';

describe('linkedCaseIds', () => {
  it('lists the explicit ids first, then the title ids, each once', () => {
    expect(linkedCaseIds(['PRB-3', 'PRB-1, PRB-2'], ['PRB-2', 'PRB-9'])).toEqual([
      'PRB-3',
      'PRB-1',
      'PRB-2',
      'PRB-9',
    ]);
  });

  it('skips blank items of the explicit lists, and keeps title ids alone', () => {
    expect(linkedCaseIds([' ', 'PRB-1, , PRB-1'], [])).toEqual(['PRB-1']);
    expect(linkedCaseIds([], ['WEB-4', 'WEB-4'])).toEqual(['WEB-4']);
    expect(linkedCaseIds([], [])).toEqual([]);
  });
});

describe('caseOf', () => {
  it('builds the created case from tags, fields and case steps, the description field apart', () => {
    const { metadata } = readMetadataMessages([
      { type: 'tags', value: ['smoke'] },
      { type: 'fields', value: { Description: 'Pays with a card', severity: 'major' } },
    ]);
    expect(caseOf(metadata, [{ action: 'Pay', expected: 'Paid' }])).toEqual({
      description: 'Pays with a card',
      tags: ['smoke'],
      fields: { severity: 'major' },
      steps: [{ action: 'Pay', expected: 'Paid' }],
    });
  });

  it('is undefined when the helpers said nothing about the case, even with a blank description', () => {
    const { metadata } = readMetadataMessages([{ type: 'fields', value: { description: ' ' } }]);
    expect(caseOf(metadata, [])).toBeUndefined();
    expect(caseOf(readMetadataMessages([]).metadata, [])).toBeUndefined();
  });
});

describe('metadataResultFields', () => {
  it('gives the parts of a result the metadata decides, with its case links', () => {
    const { metadata } = readMetadataMessages([
      { type: 'title', value: 'Pays' },
      { type: 'suite', value: ['Payments', 'Cards'] },
      { type: 'comment', value: 'On staging' },
      { type: 'parameters', value: { browser: 'webkit' } },
      { type: 'tags', value: ['smoke'] },
    ]);
    const fields = metadataResultFields(metadata, {
      caseIds: ['PRB-1', 'PRB-2'],
      caseSteps: [{ action: 'Pay' }],
    });
    expect(fields).toEqual({
      caseDisplayIds: ['PRB-1', 'PRB-2'],
      title: 'Pays',
      suitePath: ['Payments', 'Cards'],
      comment: 'On staging',
      parameters: { browser: 'webkit' },
      case: { tags: ['smoke'], steps: [{ action: 'Pay' }] },
    });
    // A plain object, safe to spread and serialize.
    expect(Object.getPrototypeOf(fields.parameters)).toBe(Object.prototype);
  });

  it('links one case with caseDisplayId, and leaves out what the metadata does not say', () => {
    const { metadata } = readMetadataMessages([]);
    expect(metadataResultFields(metadata, { caseIds: ['PRB-7'] })).toEqual({
      caseDisplayId: 'PRB-7',
    });
    expect(metadataResultFields(metadata)).toEqual({});
  });
});
