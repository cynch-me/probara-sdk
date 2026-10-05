import { buildAutomationKey, detailsOf } from '@probara/core';
import { describe, expect, it } from 'vitest';
import { relativeFile, testIdOf, toResultInput, type CypressAttempt, type TranslationContext } from './translate.js';

const FILE = 'cypress/e2e/cart.cy.js';
const withFile: TranslationContext = {
  projectCodes: ['SHOP'],
  keyIncludesFile: true,
  rootDir: '/work/app',
};
const withoutFile: TranslationContext = { ...withFile, keyIncludesFile: false };

function attempt(fake: Partial<CypressAttempt> = {}): CypressAttempt {
  return { suiteTitles: ['Cart'], title: 'adds an item', outcome: 'pass', ...fake };
}

function keyOf(input: ReturnType<typeof toResultInput>): string {
  return buildAutomationKey(input.identity, { rootDir: '/work/app' });
}

/** What the `probara.*` helpers said about an attempt, as core's reader builds it. */
function detailsOfMessages(messages: unknown[]) {
  type AttemptLine = Parameters<typeof detailsOf>[0][number];
  const lines = messages.map(
    (message): AttemptLine => ({
      file: FILE,
      test: 'Cart adds an item',
      attempt: 1,
      type: 'message',
      message: message as never,
    }),
  );
  return detailsOf(lines, '/tmp/probara');
}

describe('toResultInput', () => {
  it('gives each Mocha outcome its Probara status: a retried attempt is a failure of its own', () => {
    const statusOf = (outcome: CypressAttempt['outcome']) =>
      toResultInput(FILE, attempt({ outcome }), withFile).status;
    expect(statusOf('pass')).toBe('passed');
    expect(statusOf('fail')).toBe('failed');
    expect(statusOf('retry')).toBe('failed');
    expect(statusOf('pending')).toBe('skipped');
  });

  it('keys a test with the spec file and its full title as one segment', () => {
    const input = toResultInput(FILE, attempt({ suiteTitles: ['Cart', 'Totals'], title: 'adds VAT' }), withFile);
    expect(input.identity).toEqual({ file: FILE, titlePath: ['Cart Totals adds VAT'] });
    expect(keyOf(input)).toBe('cypress/e2e/cart.cy.js > Cart Totals adds VAT');
  });

  it('gives the suites of a created case the spec path and the describes, without their case ids', () => {
    expect(toResultInput(FILE, attempt({ suiteTitles: ['Cart', 'Totals'] }), withFile).suitePath).toEqual([
      FILE,
      'Cart',
      'Totals',
    ]);
    // A describe holds a case id like a title does: the id links the case, it is not part of its name.
    expect(
      toResultInput(FILE, attempt({ suiteTitles: ['SHOP-7 Cart'], title: 'adds an item' }), withFile)
        .suitePath,
    ).toEqual([FILE, 'Cart']);
    // Without the file, only the describes are left.
    expect(
      toResultInput(FILE, attempt({ suiteTitles: ['Cart', 'Totals'] }), withoutFile).suitePath,
    ).toEqual(['Cart', 'Totals']);
    // A test outside any describe has no suite of its own, like a Jest test without a file.
    expect(toResultInput(FILE, attempt({ suiteTitles: [], title: 'top level' }), withoutFile).suitePath).toEqual(
      [],
    );
  });

  it('links the case ids of the title, and links those probara.id() named first', () => {
    const titled = toResultInput(FILE, attempt({ title: 'adds an item SHOP-12' }), withFile);
    expect(titled.caseDisplayId).toBe('SHOP-12');
    const named = toResultInput(FILE, attempt({ title: 'adds an item SHOP-12' }), withFile, undefined, {
      ...detailsOfMessages([{ type: 'id', value: ['SHOP-9'] }]),
    });
    expect(named.caseDisplayIds).toEqual(['SHOP-9', 'SHOP-12']);
  });

  it('sends when the attempt started and how long it took', () => {
    const input = toResultInput(
      FILE,
      attempt({ durationMs: 1234 }),
      withFile,
      Date.parse('2026-10-05T09:00:00.000Z'),
    );
    expect(input.durationMs).toBe(1234);
    expect(input.startedAt).toEqual(new Date('2026-10-05T09:00:00.000Z'));
    const bare = toResultInput(FILE, attempt(), withFile);
    expect(bare).not.toHaveProperty('durationMs');
    expect(bare).not.toHaveProperty('startedAt');
  });

  it('writes the error of a failed attempt into the notes, with its stack', () => {
    const error = Object.assign(new Error('boom'), { stack: 'Error: boom\n  at spec' });
    const input = toResultInput(FILE, attempt({ outcome: 'fail', error }), withFile);
    expect(input.error).toEqual(['Error: boom\n  at spec']);
    expect(toResultInput(FILE, attempt({ outcome: 'fail' }), withFile)).not.toHaveProperty('error');
  });

  it('sends the browser Cypress runs as a parameter, never in the key, and drops it on request', () => {
    const withBrowser = { ...withFile, browser: 'electron', browserAsParameter: true };
    const input = toResultInput(FILE, attempt(), withBrowser);
    expect(input.parameters).toEqual({ browser: 'electron' });
    expect(keyOf(input)).toBe('cypress/e2e/cart.cy.js > Cart adds an item');
    expect(
      toResultInput(FILE, attempt(), { ...withBrowser, browserAsParameter: false }).parameters,
    ).toBeUndefined();
    // Without the browser (the plugin never ran), no parameter at all.
    expect(toResultInput(FILE, attempt(), withFile).parameters).toBeUndefined();
  });

  it('sends the attempt number of a retried attempt as a parameter, never in the key', () => {
    const retried = toResultInput(FILE, attempt({ outcome: 'fail', attempt: 2 }), withFile);
    expect(retried.parameters).toEqual({ attempt: '2' });
    expect(keyOf(retried)).toBe('cypress/e2e/cart.cy.js > Cart adds an item');
    // A first attempt has nothing to retry: it gets no parameter.
    expect(toResultInput(FILE, attempt(), withFile).parameters).toBeUndefined();
    // With the browser, both are sent.
    expect(
      toResultInput(
        FILE,
        attempt({ attempt: 3 }),
        { ...withFile, browser: 'electron', browserAsParameter: true },
      )
        .parameters,
    ).toEqual({ browser: 'electron', attempt: '3' });
  });

  it('lets a parameter of probara.parameters() win over the browser', () => {
    const input = toResultInput(FILE, attempt(), { ...withFile, browser: 'electron' }, undefined, {
      ...detailsOfMessages([{ type: 'parameters', value: { browser: 'firefox' } }]),
    });
    expect(input.parameters).toEqual({ browser: 'firefox' });
  });

  it('hands over what the helpers said: the title, comment, steps and files of the attempt', () => {
    const details = detailsOfMessages([
      { type: 'title', value: 'Adds an item to the cart' },
      { type: 'comment', value: 'checked by hand' },
    ]);
    const input = toResultInput(FILE, attempt(), withFile, undefined, {
      ...details,
      attachments: [{ path: '/tmp/shot.png', name: 'screenshot' }],
      steps: [{ action: 'Open the cart', status: 'passed' }],
    });
    expect(input.title).toBe('Adds an item to the cart');
    expect(input.comment).toBe('checked by hand');
    expect(input.attachments).toEqual([{ path: '/tmp/shot.png', name: 'screenshot' }]);
    expect(input.steps).toEqual([{ action: 'Open the cart', status: 'passed' }]);
  });

  it('turns the issue ids of the helpers into links with issueUrlTemplate, and warns without one', () => {
    const details = detailsOfMessages([{ type: 'issue', value: { id: 'PRB-7' } }]);
    const templated = toResultInput(
      FILE,
      attempt(),
      { ...withFile, issueUrlTemplate: 'https://jira.example.com/browse/%s' },
      undefined,
      details,
    );
    expect(templated.links).toEqual([
      { url: 'https://jira.example.com/browse/PRB-7', name: 'PRB-7' },
    ]);
    const warnings: string[] = [];
    const dropped = toResultInput(FILE, attempt(), { ...withFile, warn: (m) => warnings.push(m) }, undefined, details);
    expect(dropped).not.toHaveProperty('links');
    expect(warnings.join(' ')).toContain('no issueUrlTemplate');
  });
});

describe('relativeFile', () => {
  it('names a spec file as its key names it: relative to the root directory, with / separators', () => {
    expect(relativeFile('/work/app/cypress/e2e/cart.cy.js', '/work/app')).toBe('cypress/e2e/cart.cy.js');
    expect(relativeFile('cypress/e2e/cart.cy.js', '/work/app')).toBe('cypress/e2e/cart.cy.js');
  });
});

describe('testIdOf', () => {
  it('is the same string for every attempt of one test, and another for any other test', () => {
    const first = testIdOf(FILE, attempt());
    expect(testIdOf(FILE, attempt({ outcome: 'fail' }))).toBe(first);
    expect(testIdOf(FILE, attempt({ title: 'removes an item' }))).not.toBe(first);
    expect(testIdOf('cypress/e2e/login.cy.js', attempt())).not.toBe(first);
    // The suites are part of it: two tests of different describes never share an id.
    expect(testIdOf(FILE, attempt({ suiteTitles: ['Checkout'] }))).not.toBe(first);
  });
});