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

describe('metadataResultFields links', () => {
  const { metadata } = readMetadataMessages([
    { type: 'link', value: { url: 'https://ci.example.com/12', name: 'Build' } },
    { type: 'issue', value: { id: 'PRB-7' } },
    { type: 'issue', value: { id: 'A/B 1' } },
  ]);

  it('turns issue ids into links with the template, in call order, the id URL-encoded and as the name', () => {
    const warnings: string[] = [];
    const fields = metadataResultFields(metadata, {
      issueUrlTemplate: 'https://jira.example.com/browse/%s',
      warn: (message) => warnings.push(message),
    });
    expect(fields.links).toEqual([
      { url: 'https://ci.example.com/12', name: 'Build' },
      { url: 'https://jira.example.com/browse/PRB-7', name: 'PRB-7' },
      { url: 'https://jira.example.com/browse/A%2FB%201', name: 'A/B 1' },
    ]);
    expect(warnings).toEqual([]);
    expect(
      metadataResultFields(metadata, { issueUrlTemplate: 'https://tracker.example.com/?id=%s' })
        .links?.[1],
    ).toEqual({ url: 'https://tracker.example.com/?id=PRB-7', name: 'PRB-7' });
  });

  it('drops the issues without a template, with one warning, and keeps the links', () => {
    const warnings: string[] = [];
    const fields = metadataResultFields(metadata, { warn: (message) => warnings.push(message) });
    expect(fields.links).toEqual([{ url: 'https://ci.example.com/12', name: 'Build' }]);
    expect(warnings).toEqual([
      'Dropped the issues of probara.issue(): no issueUrlTemplate turns their ids into links',
    ]);
  });

  it('leaves links out when there are none', () => {
    const issueOnly = readMetadataMessages([{ type: 'issue', value: { id: 'PRB-7' } }]).metadata;
    expect(metadataResultFields(issueOnly)).toEqual({});
    expect(
      metadataResultFields(readMetadataMessages([]).metadata, { warn: () => undefined }),
    ).toEqual({});
  });
});
