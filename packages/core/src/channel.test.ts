/**
 * The reporter transport protocol: the lines an adapter's test side writes about one attempt, and
 * the selection it reads back. Both are what a reporter and the framework's helpers agree on, so
 * they are read and written exactly, whichever framework runs them.
 */
import { describe, expect, it } from 'vitest';
import { attemptKey, parseSelection, SELECTION_FAILURES, type ChannelLine } from './channel.js';

const FILE = '/work/app/cypress/e2e/flaky.cy.js';
const TEST = 'Flaky fails first then passes';
const REF = { file: FILE, test: TEST, attempt: 2 };
const KEY = attemptKey(FILE, TEST, 2);

/** A line as the wire carries it: one JSON text, parsed back into an untyped object. */
function wire(line: ChannelLine): Record<string, unknown> {
  return JSON.parse(JSON.stringify(line)) as Record<string, unknown>;
}

/** What a line says about the attempt it belongs to: nothing, or all three of its fields. */
function attemptOf(line: Record<string, unknown>): string | undefined {
  return typeof line.file === 'string' &&
    typeof line.test === 'string' &&
    typeof line.attempt === 'number'
    ? attemptKey(line.file, line.test, line.attempt)
    : undefined;
}

describe('the channel line protocol', () => {
  const message: ChannelLine = {
    ...REF,
    type: 'message',
    message: { type: 'comment', value: 'Paid with a saved card' },
  };
  const stepStart: ChannelLine = {
    ...REF,
    type: 'step-start',
    step: 'pay',
    parent: 'checkout',
    action: 'Pay',
    expected: 'Paid',
    data: 'card',
  };
  const stepEnd: ChannelLine = {
    ...REF,
    type: 'step-end',
    step: 'pay',
    status: 'failed',
    durationMs: 12,
    error: { message: 'boom', stack: 'Error: boom\n    at cart.ts:3' },
  };
  const attachment: ChannelLine = {
    ...REF,
    type: 'attachment',
    step: 'pay',
    name: 'receipt',
    contentType: 'text/plain',
    copy: '0f8fad5b-d9cb-469f-a165-70867728950e',
    source: '/work/app/receipt.txt',
  };
  const warning: ChannelLine = { type: 'warning', message: 'probara.tags() takes strings' };
  const setup: ChannelLine = { type: 'setup', file: FILE };
  const selection: ChannelLine = {
    type: 'selection',
    file: FILE,
    applied: true,
    deselected: [['Flaky', 'skipped one']],
  };

  it('names the attempt of every line about a test, whatever its kind', () => {
    const lines = [message, stepStart, stepEnd, attachment];
    expect(lines.map((line) => attemptOf(wire(line)))).toEqual([KEY, KEY, KEY, KEY]);
    expect(lines.map((line) => line.type)).toEqual([
      'message',
      'step-start',
      'step-end',
      'attachment',
    ]);
  });

  it('carries no attempt on the lines about the file or the run', () => {
    expect([warning, setup, selection].map((line) => attemptOf(wire(line)))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    // A warning names the test it ran in, and still belongs to no attempt.
    const ofTest: ChannelLine = { type: 'warning', message: 'x', file: FILE, test: TEST };
    expect(attemptOf(wire(ofTest))).toBeUndefined();
  });

  it('keys an attempt by its file, its test and its number, and nothing else', () => {
    expect(attemptKey(FILE, TEST, 2)).toBe(attemptKey(FILE, TEST, 2));
    expect([
      attemptKey(FILE, TEST, 1),
      attemptKey(FILE, TEST, 3),
      attemptKey('/work/app/cypress/e2e/other.cy.js', TEST, 2),
      attemptKey(FILE, 'Flaky passes first time', 2),
    ]).not.toContain(KEY);
  });

  it('keeps names that hold the separators of a key apart', () => {
    // Two attempts whose parts differ only by a ` > ` between them are two keys, not one.
    expect(attemptKey('/a/b.cy.js', 'cart pays', 1)).not.toBe(
      attemptKey('/a', 'b.cy.js > cart pays', 1),
    );
    expect(attemptKey(FILE, 'a"cart pays', 1)).not.toBe(attemptKey(FILE, 'a', 1));
  });

  it('knows every reason a selection could not be applied', () => {
    expect([...SELECTION_FAILURES]).toEqual(['no-hook', 'no-circus', 'failed']);
  });
});

describe('parseSelection', () => {
  const selection = {
    run: '01J9Z3K4M5N6P7Q8R9S0T1V2W3',
    keys: ['e2e/login.spec.ts > Login > logs in'],
    caseIds: ['SHOP-12'],
    projectCodes: ['SHOP'],
    keyIncludesFile: true,
    rootDir: '/work/app',
  };

  it('reads a selection back as it was written', () => {
    expect(parseSelection(selection)).toEqual(selection);
    expect(parseSelection({ ...selection, keys: [], caseIds: [], projectCodes: [] })).toEqual({
      ...selection,
      keys: [],
      caseIds: [],
      projectCodes: [],
    });
  });

  it('leaves out anything else the settings file happened to hold', () => {
    expect(parseSelection({ ...selection, captureOutput: true })).toEqual(selection);
  });

  it('is undefined for anything that is not a selection', () => {
    expect(parseSelection(undefined)).toBeUndefined();
    expect(parseSelection(null)).toBeUndefined();
    expect(parseSelection('SHOP-12')).toBeUndefined();
    expect(parseSelection([])).toBeUndefined();
    expect(parseSelection({ ...selection, run: 1 })).toBeUndefined();
    expect(parseSelection({ ...selection, rootDir: undefined })).toBeUndefined();
    expect(parseSelection({ ...selection, keyIncludesFile: 'true' })).toBeUndefined();
    expect(parseSelection({ ...selection, keys: 'none' })).toBeUndefined();
    expect(parseSelection({ ...selection, caseIds: ['SHOP-12', 3] })).toBeUndefined();
    expect(parseSelection({ ...selection, projectCodes: [{}] })).toBeUndefined();
  });
});
