/**
 * The browser side of a Cypress run, with a fake `cy`/`Cypress`: every helper's message and its
 * identity, the step stack, an attachment by body and by path, the console capture with its cap,
 * the settings handling and every warning path. Nothing here needs a browser; the real thing is
 * proven by `test/cypress-run.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { CypressChain } from './support-api.js';
import {
  CUT_MARKER,
  MAX_OUTPUT_BYTES,
  NO_PLUGIN,
  appendOutput,
  base64Of,
  baseName,
  binaryOf,
  createProbara,
  formatArgs,
  identityOf,
  installSupport,
  isSelected,
  readSettings,
  uuidOf,
} from './support-api.js';
import { fakeBrowser, settingsOf, type FakeBrowser } from '../test/support/browser-fakes.js';

const SPEC = 'cypress/e2e/cart.cy.js';
const TEST = 'Cart adds an item';

/** A browser with a plugin, one test running, and the settings the support file asks for. */
function browser(
  settings: Record<string, unknown> = settingsOf(),
  extra: Parameters<typeof fakeBrowser>[0] = {},
): FakeBrowser {
  return fakeBrowser({ settings, ...extra });
}

/** The lines of the transport a browser sent, of one kind. */
function linesOf(fake: FakeBrowser, type: string): Record<string, unknown>[] {
  return fake.lines().filter((line) => line['type'] === type);
}

describe('what a helper says', () => {
  it('is a line of the transport, stamped with the spec and the running test', () => {
    const fake = browser();
    installSupport(fake.context);
    fake.beforeEach();

    fake.helpers().title('Adds an item').id('SHOP-12').comment('from the cart').tags('smoke');

    expect(linesOf(fake, 'message')).toEqual([
      {
        file: SPEC,
        test: TEST,
        type: 'message',
        message: { type: 'title', value: 'Adds an item' },
      },
      {
        file: SPEC,
        test: TEST,
        type: 'message',
        message: { type: 'id', value: ['SHOP-12'] },
      },
      {
        file: SPEC,
        test: TEST,
        type: 'message',
        message: { type: 'comment', value: 'from the cart' },
      },
      {
        file: SPEC,
        test: TEST,
        type: 'message',
        message: { type: 'tags', value: ['smoke'] },
      },
    ]);
  });

  it('never stamps an attempt: the reporter resolves it from its own events', () => {
    const fake = browser();
    installSupport(fake.context);
    fake.beforeEach();

    fake.helpers().title('Adds an item');

    expect(fake.lines().every((line) => !('attempt' in line))).toBe(true);
  });

  it('goes out with the task the plugin registered, out of the Cypress log', () => {
    const fake = browser();
    installSupport(fake.context);
    fake.beforeEach();

    fake.helpers().ignore();

    expect(fake.sent).toEqual([
      {
        name: 'probara',
        payload: {
          kind: 'line',
          line: { file: SPEC, test: TEST, type: 'message', message: { type: 'ignore' } },
        },
        log: false,
      },
    ]);
  });

  it('names no test in a hook that runs none, and the reporter drops it', () => {
    const fake = browser();
    installSupport(fake.context);
    // A suite-level `before`: `Cypress.currentTest` holds nothing yet.
    fake.before();

    fake.helpers().title('Never runs');

    expect(linesOf(fake, 'message')[0]).toEqual({
      file: SPEC,
      test: '',
      type: 'message',
      message: { type: 'title', value: 'Never runs' },
    });
  });
});

describe('a warning of the browser', () => {
  it('travels to the plugin, once per message, naming the file and the test', () => {
    const fake = browser();
    installSupport(fake.context);
    fake.beforeEach();

    fake.helpers().link('not a url');
    fake.helpers().link('not a url');
    fake.helpers().link('not this either');

    // The same warning is one line, however many tests repeat it.
    expect(linesOf(fake, 'warning')).toEqual([
      {
        file: SPEC,
        test: TEST,
        type: 'warning',
        message: 'probara.link() takes an absolute http(s) URL of at most 2048 characters',
      },
    ]);
    expect(fake.sent).toHaveLength(1);
  });

  it('is a console line of its own when no plugin can be told', () => {
    const fake = fakeBrowser({ settings: undefined });
    installSupport(fake.context);
    fake.beforeEach();

    fake.helpers().title(42 as unknown as string);
    fake.helpers().title(42 as unknown as string);

    expect(fake.warnings).toEqual([NO_PLUGIN, 'probara.title() takes a string']);
    expect(fake.sent).toEqual([]);
  });
});

describe('a run with no plugin of this package', () => {
  it('publishes helpers that do nothing, and says so once', () => {
    const fake = fakeBrowser({ settings: undefined });
    installSupport(fake.context);
    fake.beforeEach();

    expect(fake.helpers()).toBeTypeOf('object');
    fake.helpers().title('Adds an item').parameters({ build: 42 });
    probaraStep(fake, 'Adds an item');

    expect(fake.sent).toEqual([]);
    expect(fake.warnings).toEqual([NO_PLUGIN]);
  });

  it('captures no console output and asks about no run selection', () => {
    const fake = fakeBrowser({ settings: undefined });
    installSupport(fake.context);

    fake.before();
    fake.beforeEach();
    fake.afterEach();

    expect(fake.console['log']).toBeTypeOf('function');
    expect(fake.sent).toEqual([]);
  });

  it('does nothing at all outside a Cypress, where there is no frame to help', () => {
    const fake = fakeBrowser({ settings: undefined });
    const outside = fakeBrowser({ settings: undefined });
    outside.context.cypress = () => undefined;

    installSupport(outside.context);

    expect(() => outside.helpers()).toThrow('published nothing');
    expect(fake.warnings).toEqual([]);
  });
});

describe('a step of a test', () => {
  it('starts, runs its body, and ends after the commands it queued', () => {
    const fake = browser();
    installSupport(fake.context);
    fake.beforeEach();

    let queued = 0;
    fake.helpers().step('Adds an item', () => {
      queued += 1;
      // A Cypress command the body queues: the fake's chain only has what the helpers use.
      fake.context.cy()?.then(() => queued);
    });
    fake.flush();

    expect(queued).toBe(1);
    const starts = linesOf(fake, 'step-start');
    const ends = linesOf(fake, 'step-end');
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      file: SPEC,
      test: TEST,
      type: 'step-start',
      action: 'Adds an item',
    });
    expect(ends[0]).toMatchObject({ file: SPEC, test: TEST, status: 'passed' });
    // The end came after the start, and after the body queued its commands.
    expect(
      fake.sent.map((each) => (each.payload as { line?: { type: string } }).line?.type),
    ).toEqual(['step-start', 'step-end']);
  });

  it('nests as the steps are called, with the parent each one names', () => {
    const fake = browser();
    installSupport(fake.context);
    fake.beforeEach();
    const helpers = fake.helpers();

    helpers.step('Adds an item', () => {
      helpers.step('Finds the cart', () => {
        helpers.step('Opens it', () => undefined);
      });
    });
    fake.flush();

    const starts = linesOf(fake, 'step-start');
    expect(starts.map((line) => line['parent'])).toEqual([
      undefined,
      starts[0]?.step,
      starts[1]?.step,
    ]);
  });

  it('is a step that passed without a body', () => {
    const fake = browser();
    installSupport(fake.context);
    fake.beforeEach();

    fake.helpers().step('Just a note');
    fake.flush();

    expect(linesOf(fake, 'step-end')[0]).toMatchObject({ status: 'passed' });
  });

  it('carries what the report creates a case with: the action, the expectation and the data', () => {
    const fake = browser();
    installSupport(fake.context);
    fake.beforeEach();

    fake.helpers().step('Adds an item', () => undefined, {
      expected: 'The cart holds one item',
      data: '{"sku":"A-1"}',
    });
    fake.flush();

    expect(linesOf(fake, 'step-start')[0]).toMatchObject({
      action: 'Adds an item',
      expected: 'The cart holds one item',
      data: '{"sku":"A-1"}',
    });
  });

  it('ends as failed when its body throws, and the test sees the error', () => {
    const fake = browser();
    installSupport(fake.context);
    fake.beforeEach();

    expect(() => {
      fake.helpers().step('Adds an item', () => {
        throw new Error('the body failed');
      });
    }).toThrow('the body failed');

    expect(linesOf(fake, 'step-end')[0]).toMatchObject({
      status: 'failed',
      error: { message: 'the body failed' },
    });
  });

  it('never ends a step whose command failed, which the reporter fails then', () => {
    const fake = browser();
    installSupport(fake.context);
    fake.beforeEach();

    fake.helpers().step('Adds an item', () => undefined);
    // The command of the step failed: Cypress never runs the `cy.then` that would end it.
    expect(linesOf(fake, 'step-end')).toEqual([]);
  });

  it('warns about a wrong argument and still runs the body', () => {
    const fake = browser();
    installSupport(fake.context);
    fake.beforeEach();
    let ran = 0;

    fake.helpers().step(42 as unknown as string, () => {
      ran += 1;
    });
    fake.flush();

    expect(ran).toBe(1);
    expect(linesOf(fake, 'warning').map((line) => line['message'])).toEqual([
      'probara.step() takes an action (a string)',
    ]);
  });

  it('warns about options that are not an object, and about a body that is not a function', () => {
    const fake = browser();
    installSupport(fake.context);
    fake.beforeEach();

    fake.helpers().step('Adds an item', undefined, 'expected' as unknown as { expected: string });
    fake.helpers().step('Adds an item', 'nope' as unknown as () => void);
    fake.flush();

    expect(linesOf(fake, 'warning').map((line) => line['message'])).toEqual([
      'probara.step() takes its options as an object ({ expected, data })',
      'probara.step() takes a function as its body',
    ]);
  });
});

describe('an attachment', () => {
  it('sends a text body as it is, with the test that attached it', () => {
    const fake = browser();
    installSupport(fake.context);
    fake.beforeEach();

    fake.helpers().attach({ name: 'note.txt', body: 'hello' });

    expect(fake.payloads().at(-1)).toEqual({
      kind: 'attachment',
      line: { file: SPEC, test: TEST, type: 'attachment', name: 'note.txt', body: 'text' },
      text: 'hello',
    });
  });

  it('sends bytes as base64, of an array, a view or a buffer', () => {
    const fake = browser();
    installSupport(fake.context);
    fake.beforeEach();
    const helpers = fake.helpers();

    helpers.attach({ name: 'a.bin', body: new Uint8Array([104, 105]) });
    helpers.attach({ name: 'b.bin', body: new Uint8Array([104, 105]).buffer });
    const view = new Uint8Array([104, 105, 33]).subarray(0, 2);
    helpers.attach({ name: 'c.bin', body: view });

    expect(
      fake
        .payloads()
        .slice(-3)
        .map((payload) => payload.base64),
    ).toEqual([btoa('hi'), btoa('hi'), btoa('hi')]);
    expect(
      fake
        .payloads()
        .slice(-3)
        .every((payload) => payload.line?.['body'] === 'bytes'),
    ).toBe(true);
  });

  it('reads a path with cy.readFile and hands the chain of that command on', () => {
    const fake = browser(settingsOf(), { files: { 'fixtures/cart.csv': 'sku,qty\nA-1,2\n' } });
    installSupport(fake.context);
    fake.beforeEach();

    const chain = fake.helpers().attach({ name: 'cart.csv', path: 'fixtures/cart.csv' });
    expect(chain).toBeDefined();
    fake.flush();

    expect(fake.payloads().at(-1)).toEqual({
      kind: 'attachment',
      line: {
        file: SPEC,
        test: TEST,
        type: 'attachment',
        name: 'cart.csv',
        body: 'bytes',
        source: 'cart.csv',
      },
      base64: btoa('sku,qty\nA-1,2\n'),
    });
  });

  it('belongs to the step it was attached in', () => {
    const fake = browser();
    installSupport(fake.context);
    fake.beforeEach();
    const helpers = fake.helpers();

    helpers.step('Adds an item', () => {
      helpers.attach({ name: 'note.txt', body: 'hello' });
      helpers.step('Finds the cart', () => {
        helpers.attach({ name: 'inner.txt', body: 'inside' });
      });
    });
    helpers.attach({ name: 'outside.txt', body: 'after' });
    fake.flush();

    const starts = linesOf(fake, 'step-start');
    expect(fake.payloads().filter((payload) => payload.kind === 'attachment')).toEqual([
      {
        kind: 'attachment',
        line: {
          ...{ file: SPEC, test: TEST, type: 'attachment', name: 'note.txt', body: 'text' },
          step: starts[0]?.step,
        },
        text: 'hello',
      },
      {
        kind: 'attachment',
        line: {
          ...{ file: SPEC, test: TEST, type: 'attachment', name: 'inner.txt', body: 'text' },
          step: starts[1]?.step,
        },
        text: 'inside',
      },
      {
        kind: 'attachment',
        line: { file: SPEC, test: TEST, type: 'attachment', name: 'outside.txt', body: 'text' },
        text: 'after',
      },
    ]);
  });

  it('warns about a wrong argument, and about a file it has neither a path nor a body of', () => {
    const fake = browser();
    installSupport(fake.context);
    fake.beforeEach();
    const helpers = fake.helpers();

    helpers.attach({ name: 'note' } as unknown as { name: string; body: string });
    helpers.attach('note.txt' as unknown as { name: string; body: string });
    helpers.attach({ name: 'note.txt', contentType: 42 } as unknown as {
      name: string;
      body: string;
    });

    expect(linesOf(fake, 'warning').map((line) => line['message'])).toEqual([
      'probara.attach() could not attach "note": it has neither a path nor a body',
      'probara.attach() takes { name, path } or { name, body }',
      'probara.attach() could not attach "note.txt": its contentType is not a string',
    ]);
    expect(fake.payloads().filter((payload) => payload.kind === 'attachment')).toEqual([]);
  });
});

describe('the console output of a test (captureOutput)', () => {
  it('is off by default: the console methods are left alone', () => {
    const fake = browser();
    const original = fake.console['log'];
    installSupport(fake.context);

    fake.before();
    fake.beforeEach();
    fake.console['log']?.('hello');
    fake.afterEach();

    expect(fake.console['log']).toBe(original);
    expect(fake.sent).toEqual([]);
    expect(fake.written).toEqual(['log: hello']);
  });

  it('attaches what the test wrote as stdout.log and stderr.log, one task each', () => {
    const fake = browser(settingsOf({ captureOutput: true }));
    installSupport(fake.context);
    fake.before();
    fake.beforeEach();

    fake.console['log']?.('a line');
    fake.console['info']?.({ sku: 'A-1' });
    fake.console['warn']?.('a warning');
    fake.console['error']?.('an error');
    fake.afterEach();

    expect(fake.payloads().filter((payload) => payload.kind === 'attachment')).toEqual([
      {
        kind: 'attachment',
        line: {
          file: SPEC,
          test: TEST,
          type: 'attachment',
          name: 'stdout.log',
          contentType: 'text/plain',
          body: 'text',
        },
        text: 'a line\n{"sku":"A-1"}\n',
      },
      {
        kind: 'attachment',
        line: {
          file: SPEC,
          test: TEST,
          type: 'attachment',
          name: 'stderr.log',
          contentType: 'text/plain',
          body: 'text',
        },
        text: 'a warning\nan error\n',
      },
    ]);
  });

  it('puts the original methods back, and keeps printing while it does', () => {
    const fake = browser(settingsOf({ captureOutput: true }));
    const original = fake.console['log'];
    installSupport(fake.context);
    fake.before();
    fake.beforeEach();
    fake.console['log']?.('captured');

    expect(fake.console['log']).not.toBe(original);
    fake.afterEach();
    expect(fake.console['log']).toBe(original);
    fake.console['log']?.('printed only');

    // The frame's console printed both, captured or not.
    expect(fake.written).toEqual(['log: captured', 'log: printed only']);
  });

  it('sends nothing of a stream the test stayed quiet in', () => {
    const fake = browser(settingsOf({ captureOutput: true }));
    installSupport(fake.context);
    fake.before();
    fake.beforeEach();
    fake.console['log']?.('only stdout');

    fake.afterEach();

    expect(fake.payloads().filter((payload) => payload.kind === 'attachment')).toHaveLength(1);
  });

  it('stamps the test that ran, even when the frame has forgotten it by the root afterEach', () => {
    const fake = browser(settingsOf({ captureOutput: true }));
    installSupport(fake.context);
    fake.before();
    fake.forgetCurrentTestInAfterEach();
    fake.beforeEach();
    fake.console['log']?.('hello');

    fake.afterEach();

    expect(fake.payloads()[0]?.line).toMatchObject({ file: SPEC, test: TEST, name: 'stdout.log' });
  });

  it('never captures what another test wrote, and each test its own', () => {
    const fake = browser(settingsOf({ captureOutput: true }));
    installSupport(fake.context);
    fake.before();

    fake.beforeEach(['Cart', 'first']);
    fake.console['log']?.('of the first');
    fake.afterEach();
    fake.flush();
    fake.beforeEach(['Cart', 'second']);
    fake.console['log']?.('of the second');
    fake.afterEach();
    fake.flush();

    const sent = fake.payloads().filter((payload) => payload.kind === 'attachment');
    expect(sent.map((payload) => [payload.line?.['test'], payload.text])).toEqual([
      ['Cart first', 'of the first\n'],
      ['Cart second', 'of the second\n'],
    ]);
  });
});

describe('the run selection (runCasesOnly)', () => {
  it('asks the plugin in a root beforeEach and skips a test it does not take', () => {
    const fake = browser(settingsOf({ runCasesOnly: true }), {
      answer: () => ({ selected: false }),
    });
    installSupport(fake.context);

    fake.beforeEach();

    expect(fake.payloads()[0]).toEqual({
      kind: 'select',
      file: SPEC,
      titlePath: ['Cart', 'adds an item'],
    });
    // The answer comes before the test runs: the skip happens while it is still a question.
    expect(fake.skipped).toEqual([]);
    fake.flush();
    expect(fake.skipped).toEqual([['Cart', 'adds an item']]);
  });

  it('leaves a test the run takes alone', () => {
    const fake = browser(settingsOf({ runCasesOnly: true }), {
      answer: () => ({ selected: true }),
    });
    installSupport(fake.context);

    fake.beforeEach();
    fake.flush();

    expect(fake.skipped).toEqual([]);
  });

  it('is quiet without a selection: no question, nothing skipped', () => {
    const fake = browser();
    installSupport(fake.context);

    fake.beforeEach();
    fake.flush();

    expect(fake.payloads().filter((payload) => payload.kind === 'select')).toEqual([]);
    expect(fake.skipped).toEqual([]);
  });

  it('reads an answer of the plugin that says nothing as a skip', () => {
    expect(isSelected({ selected: true })).toBe(true);
    for (const answer of [undefined, null, {}, { selected: 'yes' }, 42]) {
      expect(isSelected(answer)).toBe(false);
    }
  });
});

describe('the settings of the run', () => {
  it('are read once, from Cypress.expose', () => {
    const fake = browser(settingsOf({ captureOutput: true, runCasesOnly: true }));
    expect(readSettings(fake.context)).toEqual({
      version: '0.1.0',
      captureOutput: true,
      runCasesOnly: true,
    });
  });

  it('are nothing at all without a plugin', () => {
    for (const settings of [undefined, null, {}, { version: '' }, 42]) {
      expect(readSettings(fakeBrowser({ settings }).context)).toBeUndefined();
    }
  });
});

describe('the helpers that need nothing of Cypress', () => {
  it('write a message as the console would, whatever it was given', () => {
    expect(formatArgs(['a line', 42, { sku: 'A-1' }, null, undefined])).toBe(
      'a line 42 {"sku":"A-1"} null undefined',
    );
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    expect(formatArgs([cycle])).toBe('[object Object]');
    expect(formatArgs([() => undefined])).toBe('[Function anonymous]');
    expect(formatArgs([Symbol('id')])).toBe('Symbol(id)');
  });

  it('take the name of a file from any platform and the base64 of some bytes', () => {
    expect(baseName('fixtures/cart.csv')).toBe('cart.csv');
    expect(baseName('fixtures\\windows\\cart.csv')).toBe('cart.csv');
    expect(baseName('')).toBe('');
    expect(base64Of(new Uint8Array([104, 105]))).toBe(btoa('hi'));
  });

  it('tell bytes of a body from text', () => {
    expect(binaryOf('hello')).toBeUndefined();
    expect(binaryOf(new Uint8Array([1]))).toEqual(new Uint8Array([1]));
    expect(binaryOf(new Uint8Array([1, 2]).buffer)).toEqual(new Uint8Array([1, 2]));
    expect(binaryOf(42)).toBeUndefined();
  });

  it('name a step with a uuid, of the browser when it has one', () => {
    expect(uuidOf()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('cut an output at 32 MiB, with the Jest reporter marker, and keep nothing after it', () => {
    const output = { text: '', bytes: 0, full: false };
    appendOutput(output, 'a line\n');
    expect(output.text).toBe('a line\n');

    const big = { text: '', bytes: 0, full: false };
    appendOutput(big, 'x'.repeat(MAX_OUTPUT_BYTES));
    expect(big.full).toBe(false);
    expect(big.bytes).toBe(MAX_OUTPUT_BYTES);

    const over = { text: 'x'.repeat(MAX_OUTPUT_BYTES), bytes: MAX_OUTPUT_BYTES, full: false };
    appendOutput(over, 'one byte too much');
    expect(over.full).toBe(true);
    expect(over.text.endsWith(CUT_MARKER)).toBe(true);
    // What is kept is under the cap, the marker included.
    expect(new TextEncoder().encode(over.text).length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);

    const more = { ...over };
    appendOutput(more, 'and more');
    expect(more.text).toBe(over.text);
  });

  it('stamp the spec and the test that runs, and no attempt', () => {
    const fake = browser();
    installSupport(fake.context);
    expect(identityOf(fake.context)).toEqual({ file: SPEC, test: '' });
    fake.beforeEach(['Cart', 'SHOP-12 adds an item']);
    expect(identityOf(fake.context)).toEqual({ file: SPEC, test: 'Cart SHOP-12 adds an item' });
  });
});

describe('the helpers of a browser', () => {
  it('are the same object from every call of the metadata helpers, so calls chain', () => {
    const fake = browser();
    const helpers = createProbara(fake.context, readSettings(fake.context));

    expect(helpers.id('SHOP-12')).toBe(helpers);
    // A Cypress step returns nothing: it is not a promise a test can wait for.
    helpers.step('Adds an item');
    expect(helpers.id('SHOP-12')).toBe(helpers);
  });

  it('never throw into a test, whatever Cypress hands them', () => {
    const fake = browser();
    const broken: Partial<CypressChain> = {
      task: () => {
        throw new Error('Cypress refused the task');
      },
    };
    // A Cypress whose task refuses (one with no plugin registered) leaves the test alone.
    const refusing = createProbara(
      { ...fake.context, cy: () => broken as CypressChain },
      readSettings(fake.context),
    );

    expect(() => refusing.title('Adds an item')).not.toThrow();
    // The console says what Cypress refused, and the test went on.
    expect(fake.warnings).toEqual([
      'probara.* could not send what it was told: Cypress refused the task',
    ]);
  });
});

/** A step of the helpers of a browser, for a test that must not throw. */
function probaraStep(fake: FakeBrowser, title: string): void {
  fake.helpers().step(title);
}
