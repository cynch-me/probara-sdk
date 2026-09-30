import { describe, expect, it } from 'vitest';
import type { MetadataMessage } from './metadata.js';
import { readMetadataMessages } from './metadata.js';
import { createMetadataRecorder, type MetadataRecorder } from './metadata-recorder.js';

function setup() {
  const messages: MetadataMessage[] = [];
  const warnings: string[] = [];
  const recorder = createMetadataRecorder(
    (message) => messages.push(message),
    (message) => warnings.push(message),
  );
  return { messages, warnings, recorder };
}

/** The recorder as an untyped caller (a JavaScript test) may use it. */
function loose(recorder: MetadataRecorder): Record<string, (...args: unknown[]) => unknown> {
  return recorder as unknown as Record<string, (...args: unknown[]) => unknown>;
}

describe('createMetadataRecorder', () => {
  it('hands each helper call to the sink as one message, in call order', () => {
    const { messages, warnings, recorder } = setup();
    recorder.id('PRB-1');
    recorder.id(['PRB-2', ' PRB-3 ']);
    recorder.title('Checkout with a saved card');
    recorder.suite('Payments');
    recorder.suite(['Payments', 'Cards']);
    recorder.comment('Checked on staging');
    recorder.ignore();
    recorder.tags('smoke', 'checkout');

    expect(warnings).toEqual([]);
    expect(messages).toEqual([
      { type: 'id', value: ['PRB-1'] },
      { type: 'id', value: ['PRB-2', 'PRB-3'] },
      { type: 'title', value: 'Checkout with a saved card' },
      { type: 'suite', value: ['Payments'] },
      { type: 'suite', value: ['Payments', 'Cards'] },
      { type: 'comment', value: 'Checked on staging' },
      { type: 'ignore' },
      { type: 'tags', value: ['smoke', 'checkout'] },
    ]);
  });

  it('turns numbers and booleans of parameters and fields into strings', () => {
    const { messages, recorder } = setup();
    recorder.parameters({ browser: 'chromium', retries: 2, headless: true });
    recorder.fields({ severity: 'critical', estimate: 1.5, flaky: false });

    expect(messages).toEqual([
      { type: 'parameters', value: { browser: 'chromium', retries: '2', headless: 'true' } },
      { type: 'fields', value: { severity: 'critical', estimate: '1.5', flaky: 'false' } },
    ]);
  });

  it('drops blank tags and suite titles with a warning, keeping the others', () => {
    const { messages, warnings, recorder } = setup();
    recorder.tags('smoke', ' ', 'checkout');
    recorder.suite(['Payments', '', 'Cards']);

    expect(messages).toEqual([
      { type: 'tags', value: ['smoke', 'checkout'] },
      { type: 'suite', value: ['Payments', 'Cards'] },
    ]);
    expect(warnings).toEqual([
      'probara.tags() ignores blank tags',
      'probara.suite() ignores blank suite titles',
    ]);
  });

  it('warns and sends nothing for arguments of the wrong type, never throwing', () => {
    const { messages, warnings, recorder } = setup();
    const untyped = loose(recorder);
    untyped.id?.(42);
    untyped.id?.(['PRB-1', 7]);
    untyped.title?.({ text: 'x' });
    untyped.suite?.(['ok', 3]);
    untyped.comment?.(null);
    untyped.parameters?.('browser=chromium');
    untyped.parameters?.(['chromium']);
    untyped.tags?.('smoke', null);
    untyped.fields?.({ severity: { level: 1 } });
    untyped.fields?.(null);

    expect(messages).toEqual([]);
    expect(warnings).toEqual([
      'probara.id() takes a case id or a list of case ids, such as PRB-12',
      'probara.id() takes a case id or a list of case ids, such as PRB-12',
      'probara.title() takes a string',
      'probara.suite() takes a suite title or a list of suite titles',
      'probara.comment() takes a string',
      'probara.parameters() takes an object of strings, numbers or booleans',
      'probara.parameters() takes an object of strings, numbers or booleans',
      'probara.tags() takes strings',
      'probara.fields() takes an object of strings, numbers or booleans',
      'probara.fields() takes an object of strings, numbers or booleans',
    ]);
  });

  it('sends messages the merge rules accept', () => {
    const { messages, recorder } = setup();
    recorder.id(['PRB-2', 'PRB-2, PRB-3']);
    recorder.title(' Pays ');
    recorder.parameters({ browser: 'webkit' });
    recorder.fields({ description: 'Pays with a card' });

    const { metadata, problems } = readMetadataMessages(messages);
    expect(problems).toEqual([]);
    expect(metadata).toMatchObject({ ids: ['PRB-2', 'PRB-3'], title: 'Pays' });
    expect({ ...metadata.parameters }).toEqual({ browser: 'webkit' });
  });

  it('warns instead of throwing when the sink fails', () => {
    const warnings: string[] = [];
    const recorder = createMetadataRecorder(
      (message) => {
        throw new Error(`no test runs (${message.type})`);
      },
      (message) => warnings.push(message),
    );
    expect(() => {
      recorder.title('x');
    }).not.toThrow();
    expect(() => {
      recorder.ignore();
    }).not.toThrow();
    expect(warnings).toEqual([
      'probara.title() could not be recorded: no test runs (title)',
      'probara.ignore() could not be recorded: no test runs (ignore)',
    ]);
  });
});

describe('caseStep', () => {
  it('returns the declaration of a case step as given, and sends nothing', () => {
    const { messages, warnings, recorder } = setup();
    expect(recorder.caseStep('Open the cart', 'The cart lists 2 items', 'sku=42')).toEqual({
      action: 'Open the cart',
      expected: 'The cart lists 2 items',
      data: 'sku=42',
    });
    expect(recorder.caseStep(' Pay ')).toEqual({ action: ' Pay ' });
    expect(messages).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('names the part that is not a string, and declares nothing', () => {
    const { warnings, recorder } = setup();
    expect(recorder.caseStep(undefined)).toBeUndefined();
    expect(recorder.caseStep('Pay', 3)).toBeUndefined();
    expect(recorder.caseStep('Pay', 'Paid', { card: 'visa' })).toBeUndefined();
    expect(recorder.caseStep(7, 'Paid')).toBeUndefined();
    expect(warnings).toEqual([
      'probara.step() takes an action (a string)',
      'probara.step() takes the expected result as a string',
      'probara.step() takes the data as a string',
      'probara.step() takes an action (a string)',
    ]);
  });
});
