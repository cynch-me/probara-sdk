/**
 * The protocol the browser and the plugin of a Cypress run share: what `Cypress.expose('probara')`
 * holds and what a `cy.task('probara', …)` may carry. Nothing here needs a browser or a Cypress,
 * which is the point: a payload the support file of another version sent is dropped, never
 * reported, and never an error into a test.
 */
import { describe, expect, it } from 'vitest';
import {
  ATTACH_LABEL,
  isAbout,
  labelOf,
  parseSettings,
  payloadOf,
  type BrowserLine,
} from './browser-message.js';

/** What the plugin exposes for a run that has one. */
function settings(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { version: '0.1.0', captureOutput: false, runCasesOnly: false, ...extra };
}

describe('the settings the browser reads back', () => {
  it('are what the plugin exposed: its version, the console setting and the run selection', () => {
    expect(parseSettings(settings())).toEqual({
      version: '0.1.0',
      captureOutput: false,
      runCasesOnly: false,
    });
    expect(parseSettings(settings({ captureOutput: true, runCasesOnly: true }))).toEqual({
      version: '0.1.0',
      captureOutput: true,
      runCasesOnly: true,
    });
  });

  it('are nothing at all without a plugin: every helper is then a no-op', () => {
    for (const given of [undefined, null, 42, 'a string', {}, { version: '' }, []]) {
      expect(parseSettings(given)).toBeUndefined();
    }
  });

  it('turn every setting off when what the plugin exposed cannot be read', () => {
    for (const given of [
      settings({ captureOutput: 'yes', runCasesOnly: 'yes' }),
      settings({ selection: { run: '01J9Z3K4M5N6P7Q8R9S0T1V2W3' } }),
    ]) {
      expect(parseSettings(given)).toEqual({
        version: '0.1.0',
        captureOutput: false,
        runCasesOnly: false,
      });
    }
  });
});

describe('what a cy.task("probara") may carry', () => {
  it('is a line of the transport, with the identity the browser stamped', () => {
    expect(
      payloadOf({
        kind: 'line',
        line: {
          file: 'cypress/e2e/cart.cy.js',
          test: 'Cart adds an item',
          type: 'message',
          message: { type: 'title', value: 'Adds an item' },
        },
      }),
    ).toEqual({
      kind: 'line',
      line: {
        file: 'cypress/e2e/cart.cy.js',
        test: 'Cart adds an item',
        type: 'message',
        message: { type: 'title', value: 'Adds an item' },
      },
    });
    // A step, its end and a warning are lines of the same transport.
    for (const line of [
      { step: 'a', action: 'Adds an item', type: 'step-start' },
      { step: 'a', status: 'passed', durationMs: 3, type: 'step-end' },
      { message: 'probara.link() takes an absolute http(s) URL', type: 'warning' },
    ] satisfies Record<string, unknown>[]) {
      expect(
        payloadOf({
          kind: 'line',
          line: { file: 'cypress/e2e/cart.cy.js', test: 'Cart adds an item', ...line },
        }),
      ).toMatchObject({ kind: 'line' });
    }
  });

  it('is a file to copy, with its bytes out of the line', () => {
    const line = {
      type: 'attachment',
      name: 'cart.csv',
      source: 'cart.csv',
      body: 'bytes',
    } as const;
    expect(
      payloadOf({
        kind: 'attachment',
        line: { file: 'cypress/e2e/cart.cy.js', test: 'Cart adds an item', ...line },
        base64: 'YSxi',
      }),
    ).toMatchObject({ kind: 'attachment', base64: 'YSxi' });
    expect(
      payloadOf({
        kind: 'attachment',
        line: {
          file: 'cypress/e2e/cart.cy.js',
          test: 'Cart adds an item',
          type: 'attachment',
          name: 'note',
          body: 'text',
        },
        text: 'hello',
      }),
    ).toMatchObject({ kind: 'attachment', text: 'hello' });
  });

  it('is the question of the run selection, with the spec and the title path', () => {
    expect(
      payloadOf({ kind: 'select', file: 'cypress/e2e/cart.cy.js', titlePath: ['Cart', 'pays'] }),
    ).toEqual({ kind: 'select', file: 'cypress/e2e/cart.cy.js', titlePath: ['Cart', 'pays'] });
  });

  it('is nothing else, which is dropped rather than reported', () => {
    for (const given of [
      undefined,
      null,
      42,
      'a string',
      {},
      { kind: 'something-else' },
      { kind: 'line', line: { type: 'message' } },
      { kind: 'line', line: { file: 'a.cy.js', test: 'x', type: 'unknown' } },
      // A step with no action, a warning with no message, an attachment with no bytes: a payload a
      // broken version of the support file may send, and no test may fail of it.
      { kind: 'line', line: { file: 'a.cy.js', test: 'x', type: 'step-start', step: 'a' } },
      { kind: 'line', line: { file: 'a.cy.js', test: 'x', type: 'warning' } },
      { kind: 'attachment', line: { file: 'a.cy.js', test: 'x', type: 'attachment', name: 'n' } },
      {
        kind: 'attachment',
        line: { file: 'a.cy.js', test: 'x', type: 'attachment', name: 'n', body: 'bytes' },
      },
      { kind: 'select', file: 'a.cy.js', titlePath: 'Cart pays' },
      { kind: 'select', titlePath: [] },
    ]) {
      expect(payloadOf(given)).toBeUndefined();
    }
  });
});

describe('a line of the browser', () => {
  const identity = { file: 'cypress/e2e/cart.cy.js', test: 'Cart adds an item' };

  it('names the helper it came from, for a warning about it', () => {
    expect(
      labelOf({ ...identity, type: 'message', message: { type: 'id', value: ['SHOP-12'] } }),
    ).toBe('probara.id()');
    expect(labelOf({ ...identity, type: 'step-start', step: 'a', action: 'Adds' })).toBe(
      'probara.step()',
    );
    expect(labelOf({ ...identity, type: 'warning', message: 'x' })).toBe('a probara.* warning');
    expect(ATTACH_LABEL).toBe('probara.attach()');
  });

  it('belongs to the attempt of the test it names, and to no other', () => {
    const line: BrowserLine = {
      ...identity,
      type: 'message',
      message: { type: 'title', value: 'Adds an item' },
    };
    expect(isAbout(line, 'cypress/e2e/cart.cy.js', 'Cart adds an item')).toBe(true);
    expect(isAbout(line, 'cypress/e2e/other.cy.js', 'Cart adds an item')).toBe(false);
    expect(isAbout(line, 'cypress/e2e/cart.cy.js', 'Cart pays by card')).toBe(false);
    // A helper in a suite hook stamps no test: it belongs to no attempt at all.
    expect(isAbout({ ...identity, test: '' }, 'cypress/e2e/cart.cy.js', '')).toBe(false);
  });
});
