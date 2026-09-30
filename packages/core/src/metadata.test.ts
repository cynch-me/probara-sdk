import { describe, expect, it } from 'vitest';
import {
  applyMetadataMessage,
  CASE_ANNOTATION,
  emptyMetadata,
  readMetadataMessages,
} from './metadata.js';

describe('readMetadataMessages', () => {
  it('merges messages in call order: the last title, suite and comment win', () => {
    const { metadata, problems } = readMetadataMessages([
      { type: 'title', value: 'First title' },
      { type: 'title', value: ' Checkout with a saved card ' },
      { type: 'suite', value: ['Payments'] },
      { type: 'suite', value: ['Payments', ' Cards '] },
      { type: 'comment', value: 'Checked on staging' },
    ]);
    expect(problems).toEqual([]);
    expect(metadata).toMatchObject({
      title: 'Checkout with a saved card',
      suitePath: ['Payments', 'Cards'],
      comment: 'Checked on staging',
      ignored: false,
    });
  });

  it('merges parameters and fields by name, accumulates tags and ids once each, and marks ignore', () => {
    const { metadata, problems } = readMetadataMessages([
      { type: 'parameters', value: { browser: 'chromium', retries: '2' } },
      { type: 'parameters', value: { browser: 'firefox' } },
      { type: 'fields', value: { severity: 'critical', description: ' Pays ' } },
      { type: 'fields', value: { severity: 'major' } },
      { type: 'tags', value: ['smoke', 'checkout'] },
      { type: 'tags', value: ['smoke', ' regression ', ''] },
      { type: 'id', value: ['PRB-1'] },
      { type: 'id', value: ['PRB-2, PRB-1', ' PRB-3 '] },
      { type: 'ignore' },
    ]);
    expect(problems).toEqual([]);
    expect({ ...metadata.parameters }).toEqual({ browser: 'firefox', retries: '2' });
    expect({ ...metadata.fields }).toEqual({ severity: 'major', description: 'Pays' });
    expect(metadata.tags).toEqual(['smoke', 'checkout', 'regression']);
    expect(metadata.ids).toEqual(['PRB-1', 'PRB-2', 'PRB-3']);
    expect(metadata.ignored).toBe(true);
  });

  it('keeps case step declarations by reference, without blank optional parts', () => {
    const { metadata } = readMetadataMessages([
      { type: 'step', value: { ref: 1, action: 'Open the cart', expected: '2 items', data: 'x' } },
      { type: 'step', value: { ref: 2, action: 'Pay', expected: ' ' } },
    ]);
    expect([...metadata.steps]).toEqual([
      [1, { action: 'Open the cart', expected: '2 items', data: 'x' }],
      [2, { action: 'Pay' }],
    ]);
  });

  it('leaves out malformed messages with one problem each, never throwing', () => {
    const { metadata, problems } = readMetadataMessages([
      undefined,
      'title',
      { type: 'future', value: 1 },
      { type: 'title', value: 3 },
      { type: 'id', value: 'PRB-1' },
      { type: 'step', value: { ref: 0, action: 'x' } },
      { type: 'step', value: { ref: 1.5, action: 'x' } },
      { type: 'parameters', value: { __proto__: 'x', browser: 'webkit' } },
      JSON.parse('{"type":"fields","value":{"__proto__":"x"}}') as unknown,
      { type: 'tags', value: ['smoke', 1] },
    ]);
    expect(problems).toEqual([
      'Ignored malformed probara metadata (type "?")',
      'Ignored malformed probara metadata (type "?")',
      'Ignored malformed probara metadata (type "future")',
      'Ignored malformed probara metadata (type "title")',
      'Ignored malformed probara metadata (type "id")',
      'Ignored malformed probara metadata (type "step")',
      'Ignored malformed probara metadata (type "step")',
      'Ignored malformed probara metadata (type "fields")',
      'Ignored malformed probara metadata (type "tags")',
    ]);
    expect(metadata.title).toBeUndefined();
    expect(metadata.steps.size).toBe(0);
    expect({ ...metadata.fields }).toEqual({});
    // `{ __proto__: 'x' }` in a literal sets no key: the browser alone is kept.
    expect({ ...metadata.parameters }).toEqual({ browser: 'webkit' });
  });

  it('accepts a blank title or comment as a no-op, and an empty suite as no suite', () => {
    const { metadata, problems } = readMetadataMessages([
      { type: 'title', value: 'Kept' },
      { type: 'title', value: ' ' },
      { type: 'comment', value: '' },
      { type: 'suite', value: ['', ' '] },
    ]);
    expect(problems).toEqual([]);
    expect(metadata.title).toBe('Kept');
    expect(metadata.comment).toBeUndefined();
    expect(metadata.suitePath).toBeUndefined();
  });
});

describe('applyMetadataMessage', () => {
  it('merges into the metadata it is given, and says whether the message was well formed', () => {
    const metadata = emptyMetadata();
    expect(applyMetadataMessage(metadata, { type: 'tags', value: ['smoke'] })).toBe(true);
    expect(applyMetadataMessage(metadata, { type: 'tags', value: ['api'] })).toBe(true);
    expect(applyMetadataMessage(metadata, { type: 'tags', value: 'api' })).toBe(false);
    expect(metadata.tags).toEqual(['smoke', 'api']);
  });

  it('gives every attempt metadata of its own', () => {
    const first = emptyMetadata();
    applyMetadataMessage(first, { type: 'parameters', value: { browser: 'webkit' } });
    expect({ ...emptyMetadata().parameters }).toEqual({});
    expect(emptyMetadata()).toMatchObject({ ignored: false, tags: [], ids: [] });
  });
});

describe('CASE_ANNOTATION', () => {
  it('is the name the JUnit import reads case links from', () => {
    expect(CASE_ANNOTATION).toBe('probara_case');
  });
});
