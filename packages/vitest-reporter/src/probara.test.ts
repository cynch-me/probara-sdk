/**
 * The `probara.*` helpers of a running test: what they record on its `task.meta`, read back with
 * core's reader the reporter uses, and what they do without a test or without the reporter. The
 * running test is given through the slot the runner extension installs; no Vitest run is needed.
 */
import { detailsOf, type ChannelLine } from '@probara/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProbaraTaskMeta } from './attempts.js';
import { CURRENT_TEST_SLOT, type CurrentTest, type RunningTest } from './current-test-slot.js';
import { probara } from './probara.js';

const globals = globalThis as unknown as Record<symbol, unknown>;

/** Makes `test` the running test of the helpers, as the slot of the runner extension does. */
function runWith(test: RunningTest | undefined, exact = true): void {
  globals[CURRENT_TEST_SLOT] = {
    current: (): CurrentTest | undefined => (test === undefined ? undefined : { test, exact }),
  };
}

function taskNamed(name: string, concurrent = false): RunningTest {
  return { name, file: { filepath: '/work/shop/tests/checkout.test.ts' }, meta: {}, concurrent };
}

/** The lines the helpers wrote for `test`, as the reporter reads them. */
function linesOf(test: RunningTest): ChannelLine[] {
  return (test.meta.probara as ProbaraTaskMeta | undefined)?.lines ?? [];
}

/** The details of `test`, read the way the reporter reads them. */
function detailsOfTest(test: RunningTest) {
  return detailsOf(linesOf(test), '');
}

function warnings(): string[] {
  return vi.mocked(console.warn).mock.calls.map(([message]) => String(message));
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  Reflect.deleteProperty(globals, CURRENT_TEST_SLOT);
  vi.restoreAllMocks();
});

describe('probara.* in a running test', () => {
  it('records the metadata of the running test: title, suite, comment, parameters, tags, fields, a link and an issue', () => {
    const test = taskNamed('checks the total');
    runWith(test);
    probara
      .title('Checkout total')
      .suite(['Payments', 'Cards'])
      .comment('Runs on staging only')
      .parameters({ region: 'eu', attempts: 2, fast: true })
      .tags('smoke', 'payments')
      .fields({ priority: 'high', description: 'The total of the cart' })
      .link('https://ci.example.com/build/12', 'Build')
      .issue('SHOP-7');
    expect(detailsOfTest(test).metadata).toMatchObject({
      title: 'Checkout total',
      suitePath: ['Payments', 'Cards'],
      comment: 'Runs on staging only',
      parameters: { region: 'eu', attempts: '2', fast: 'true' },
      tags: ['smoke', 'payments'],
      fields: { priority: 'high', description: 'The total of the cart' },
      links: [{ url: 'https://ci.example.com/build/12', name: 'Build' }, { issue: 'SHOP-7' }],
    });
  });

  it('keeps the last title and comment, merges parameters and fields by name, and accumulates ids and tags once each', () => {
    const test = taskNamed('merges the calls');
    runWith(test);
    probara
      .title('First')
      .title('Second')
      .comment('one')
      .comment('two')
      .parameters({ a: 1, b: 2 })
      .parameters({ b: 3 })
      .fields({ priority: 'low' })
      .fields({ severity: 'major' })
      .tags('a', 'b')
      .tags('b', 'c')
      .id(['SHOP-12', 'SHOP-13'])
      .id('SHOP-13');
    const { metadata } = detailsOfTest(test);
    expect(metadata.title).toBe('Second');
    expect(metadata.comment).toBe('two');
    expect(metadata.parameters).toEqual({ a: '1', b: '3' });
    expect(metadata.fields).toEqual({ priority: 'low', severity: 'major' });
    expect(metadata.tags).toEqual(['a', 'b', 'c']);
    expect(metadata.ids).toEqual(['SHOP-12', 'SHOP-13']);
  });

  it('leaves the attempt out with ignore()', () => {
    const test = taskNamed('is ignored');
    runWith(test);
    probara.ignore();
    expect(detailsOfTest(test).metadata.ignored).toBe(true);
  });

  it('returns the helpers themselves, so the calls chain', () => {
    runWith(taskNamed('chains'));
    expect(probara.title('x')).toBe(probara);
    expect(probara.tags('x')).toBe(probara);
  });

  it('nests steps as they run, and gives the case of the report the outermost ones with their expected result and data', () => {
    const test = taskNamed('nests steps');
    runWith(test);
    probara.step(
      'Open the cart',
      () => {
        probara.step('Add the item', () => 1, { expected: 'The cart has one item', data: 'SKU-1' });
      },
      { expected: 'The cart is open' },
    );
    const { steps, caseSteps } = detailsOfTest(test);
    expect(steps).toEqual([
      {
        action: 'Open the cart',
        status: 'passed',
        durationMs: expect.any(Number) as number,
        expected: 'The cart is open',
        steps: [
          {
            action: 'Add the item',
            status: 'passed',
            durationMs: expect.any(Number) as number,
            expected: 'The cart has one item',
            data: 'SKU-1',
          },
        ],
      },
    ]);
    expect(caseSteps).toEqual([{ action: 'Open the cart', expected: 'The cart is open' }]);
  });

  it('rethrows the error of a failing step, and records the step failed with that error', () => {
    const test = taskNamed('fails a step');
    runWith(test);
    expect(() =>
      probara.step('Submit', () => {
        throw new Error('the card was declined');
      }),
    ).toThrow('the card was declined');
    expect(detailsOfTest(test).steps).toEqual([
      expect.objectContaining({
        action: 'Submit',
        status: 'failed',
        error: { message: 'the card was declined', stack: expect.any(String) as string },
      }),
    ]);
  });

  it('reports a step the test never waited for as unfinished, with the reason Probara gives', () => {
    const test = taskNamed('leaves a step running');
    runWith(test);
    // The promise of the step is never awaited: that is the case under test.
    void probara.step('Wait for the email', () => new Promise<void>(() => undefined));
    expect(detailsOfTest(test).steps).toEqual([
      expect.objectContaining({
        action: 'Wait for the email',
        status: 'failed',
        error: { message: 'The step had not finished when the test ended' },
      }),
    ]);
  });

  it('settles a step with the promise of its body: the value comes back, and the step passes when it resolves', async () => {
    const test = taskNamed('awaits a step');
    runWith(test);
    const value = await probara.step('Load the page', async () => {
      await Promise.resolve();
      return 'ready';
    });
    expect(value).toBe('ready');
    expect(detailsOfTest(test).steps).toEqual([
      expect.objectContaining({ action: 'Load the page', status: 'passed' }),
    ]);
  });

  it('runs a step without a body as a step that passed', () => {
    const test = taskNamed('has a bare step');
    runWith(test);
    probara.step('Note the time');
    expect(detailsOfTest(test).steps).toEqual([
      expect.objectContaining({ action: 'Note the time', status: 'passed' }),
    ]);
  });

  it('turns a wrong argument into one warning in the test, and records nothing for it', () => {
    const test = taskNamed('gets a wrong argument');
    runWith(test);
    probara.id(5 as unknown as string);
    expect(detailsOfTest(test).metadata.ids).toEqual([]);
    expect(linesOf(test)).toContainEqual({
      type: 'warning',
      message: 'probara.id() takes a case id or a list of case ids, such as PRB-12',
    });
  });
});

describe('probara.* outside a test, or without the reporter', () => {
  it('warns once per helper, by its name, when it runs outside a test, and records nothing', () => {
    runWith(undefined);
    probara.title('Outside a test').title('Again');
    probara.id('SHOP-1');
    expect(warnings()).toEqual([
      expect.stringContaining('probara.title() only works while a test runs') as string,
      expect.stringContaining('probara.id() only works while a test runs') as string,
    ]);
  });

  it('does nothing without the reporter, and a step still runs its body', () => {
    expect(probara.title('Nobody reads this')).toBe(probara);
    expect(probara.step('Calculates', () => 40 + 2)).toBe(42);
    expect(warnings()).toEqual([]);
  });

  it('drops the calls of a concurrent test that no store found, with one warning, rather than record them in another test', () => {
    const concurrent = taskNamed('concurrent without its store', true);
    runWith(concurrent, false);
    probara.title('Maybe another test').title('Still maybe');
    expect(linesOf(concurrent)).toEqual([]);
    expect(warnings()).toEqual([expect.stringContaining('concurrent') as string]);
  });
});
