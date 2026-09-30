import type { TestStep } from '@playwright/test/reporter';
import { describe, expect, it } from 'vitest';
import type { CaseStep } from './metadata.js';
import { translateSteps } from './steps.js';

type Attachment = TestStep['attachments'][number];

interface StepOptions {
  category?: string;
  steps?: TestStep[];
  duration?: number;
  error?: TestStep['error'];
  annotations?: TestStep['annotations'];
  attachments?: Attachment[];
}

/** A step as Playwright 1.50+ reports it (with annotations and attachments). */
function step(title: string, options: StepOptions = {}): TestStep {
  return {
    title,
    category: options.category ?? 'test.step',
    steps: options.steps ?? [],
    duration: options.duration ?? 5,
    annotations: options.annotations ?? [],
    attachments: options.attachments ?? [],
    ...(options.error === undefined ? {} : { error: options.error }),
  } as unknown as TestStep;
}

/** A step as Playwright 1.42 reports it: no annotations, no attachments. */
function oldStep(title: string, category: string, steps: TestStep[] = []): TestStep {
  return { title, category, steps, duration: 3 } as unknown as TestStep;
}

function file(name: string): Attachment {
  return { name, contentType: 'text/plain', body: Buffer.from(name) };
}

const toFile = (attachment: Attachment) => ({ name: attachment.name });
const none = new Map<number, CaseStep>();

describe('translateSteps', () => {
  it('keeps test.step steps with their nesting, statuses, durations and errors', () => {
    const { steps } = translateSteps(
      [
        step('Open the cart', {
          duration: 12,
          steps: [
            step('Click', { category: 'pw:api' }),
            step('Check the total', {
              error: { message: 'Expected 2', stack: 'Error: Expected 2\n    at cart.spec.ts:9' },
            }),
          ],
        }),
        step('Pay later', { annotations: [{ type: 'skip' }] }),
        step('Expect "toBe"', { category: 'expect' }),
      ],
      none,
      toFile,
    );
    expect(steps).toEqual([
      {
        action: 'Open the cart',
        status: 'passed',
        durationMs: 12,
        steps: [
          {
            action: 'Check the total',
            status: 'failed',
            durationMs: 5,
            error: { message: 'Expected 2', stack: 'Error: Expected 2\n    at cart.spec.ts:9' },
          },
        ],
      },
      { action: 'Pay later', status: 'skipped', durationMs: 5 },
    ]);
  });

  it('keeps hooks that ran test.step steps, prunes the others, and lifts steps out of fixtures', () => {
    const { steps } = translateSteps(
      [
        step('Before Hooks', {
          category: 'hook',
          steps: [
            step('beforeEach hook', { category: 'hook', steps: [step('Log in')] }),
            step('fixture: page', {
              category: 'fixture',
              steps: [step('Seed the cart'), step('Navigate', { category: 'pw:api' })],
            }),
          ],
        }),
        step('Pay'),
        step('After Hooks', {
          category: 'hook',
          steps: [step('afterEach hook', { category: 'hook' })],
        }),
        step('Worker Cleanup', { category: 'hook' }),
      ],
      none,
      toFile,
    );
    expect(steps).toEqual([
      {
        action: 'Before Hooks',
        status: 'passed',
        durationMs: 5,
        steps: [
          {
            action: 'beforeEach hook',
            status: 'passed',
            durationMs: 5,
            steps: [{ action: 'Log in', status: 'passed', durationMs: 5 }],
          },
          { action: 'Seed the cart', status: 'passed', durationMs: 5 },
        ],
      },
      { action: 'Pay', status: 'passed', durationMs: 5 },
    ]);
  });

  it('reads probara.step() titles: the action without its marker, the expected result and data', () => {
    const declared = new Map<number, CaseStep>([
      [1, { action: 'Open the cart', expected: 'It lists 1 item', data: 'sku=42' }],
      [2, { action: 'Pay', expected: 'Paid' }],
      [3, { action: 'Log in' }],
      [4, { action: 'Never ran' }],
    ]);
    const { steps, caseSteps } = translateSteps(
      [
        step('Before Hooks', {
          category: 'hook',
          steps: [
            step('beforeEach hook', { category: 'hook', steps: [step('Log in [probara:3]')] }),
          ],
        }),
        step('Checkout', {
          steps: [step('Open the cart [probara:1]', { steps: [step('Pay [probara:2]')] })],
        }),
        step('Forgotten [probara:9]'),
      ],
      declared,
      toFile,
    );
    expect(steps[1]).toEqual({
      action: 'Checkout',
      status: 'passed',
      durationMs: 5,
      steps: [
        {
          action: 'Open the cart',
          status: 'passed',
          durationMs: 5,
          expected: 'It lists 1 item',
          data: 'sku=42',
          steps: [{ action: 'Pay', status: 'passed', durationMs: 5, expected: 'Paid' }],
        },
      ],
    });
    expect(steps[2]).toEqual({ action: 'Forgotten', status: 'passed', durationMs: 5 });
    // The outermost declared steps that ran, in the order they started: a declared step inside
    // another is a sub-step of the result only.
    expect(caseSteps).toEqual([
      { action: 'Log in' },
      { action: 'Open the cart', expected: 'It lists 1 item', data: 'sku=42' },
    ]);
  });

  it('gives each test.step the files attached while it ran, and leaves the others to the result', () => {
    const inner = file('inner.txt');
    const outer = file('outer.txt');
    const top = file('top.txt');
    const hooked = file('hooked.txt');
    const meta = { name: '_probara', contentType: 'application/vnd.probara.metadata+json' };
    const { steps, claimed } = translateSteps(
      [
        step('Outer', {
          attachments: [outer, meta],
          steps: [
            step('Inner', {
              steps: [
                step('Attach "inner.txt"', { category: 'test.attach', attachments: [inner] }),
              ],
            }),
          ],
        }),
        step('Attach "top.txt"', { category: 'test.attach', attachments: [top] }),
        step('After Hooks', {
          category: 'hook',
          attachments: [hooked],
          steps: [step('afterEach hook', { category: 'hook', steps: [step('Clean up')] })],
        }),
      ],
      none,
      toFile,
    );
    expect(steps[0]).toMatchObject({
      action: 'Outer',
      attachments: [{ name: 'outer.txt' }],
      steps: [{ action: 'Inner', attachments: [{ name: 'inner.txt' }] }],
    });
    expect(steps[1]).not.toHaveProperty('attachments');
    expect([...claimed]).toEqual([outer, meta, inner]);
  });

  it('reads the steps of Playwright 1.42, which carry no annotations and no attachments', () => {
    const { steps, claimed } = translateSteps(
      [
        oldStep('Before Hooks', 'hook', [oldStep('beforeEach hook', 'hook')]),
        oldStep('Open', 'test.step', [oldStep('attach "cart"', 'attach')]),
      ],
      none,
      toFile,
    );
    expect(steps).toEqual([{ action: 'Open', status: 'passed', durationMs: 3 }]);
    expect(claimed.size).toBe(0);
  });
});
