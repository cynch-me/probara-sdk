/**
 * `probara.*` in a test process, read back as the reporter reads the channel: what each helper
 * records for the running attempt, the warnings it gives, and that it never breaks a test.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { TestStepInput } from '@probara/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attemptKey } from './channel.js';
import {
  createChannel,
  type AttemptDetails,
  type Channel,
  type ChannelWarning,
} from './channel-reader.js';
import type { CurrentTest } from './current-test.js';
import { createProbara, type Probara } from './probara.js';

const FILE = '/work/app/tests/cart.test.js';
const PAYS: CurrentTest = { file: FILE, test: 'cart pays by card', attempt: 1 };

let channel: Channel;
let warnings: ChannelWarning[];
let running: CurrentTest | undefined;
let probara: Probara;
let scratch: string;

beforeEach(() => {
  warnings = [];
  channel = createChannel((warning) => warnings.push(warning));
  running = PAYS;
  probara = createProbara({ channel: () => channel.dir, currentTest: () => running });
  scratch = mkdtempSync(join(tmpdir(), 'probara-jest-scratch-'));
});

afterEach(() => {
  channel.close();
  rmSync(scratch, { recursive: true, force: true });
});

/** The details of `test` (attempt 1 of "cart pays by card" by default), as the reporter reads them. */
function detailsOf(test: CurrentTest = PAYS): AttemptDetails | undefined {
  return channel.take(test.file).get(attemptKey(test.file, test.test, test.attempt));
}

/** A step tree without durations. */
function shapeOf(steps: readonly TestStepInput[] | undefined): unknown {
  return steps?.map(({ durationMs, steps: children, attachments, ...rest }) => ({
    ...rest,
    ...(typeof durationMs === 'number' ? {} : { durationMs }),
    ...(children === undefined ? {} : { steps: shapeOf(children) }),
    ...(attachments === undefined ? {} : { attachments: attachments.map((file) => file.name) }),
  }));
}

describe('probara metadata helpers', () => {
  it("records every helper's call for the running attempt, merged like Playwright's", () => {
    const chained = probara
      .id('PRB-12')
      .id(['PRB-13', ' PRB-12 '])
      .title('Pays with a saved card')
      .suite(['Payments', 'Cards'])
      .comment('first')
      .comment('after the retry')
      .tags('smoke', 'cards')
      .tags('smoke')
      .parameters({ card: 'visa', amount: 12 })
      .parameters({ card: 'amex' })
      .fields({ severity: 'critical', description: 'Pays with a card on file' });
    expect(chained).toBe(probara);

    const details = detailsOf();
    expect(details?.metadata).toMatchObject({
      ids: ['PRB-12', 'PRB-13'],
      title: 'Pays with a saved card',
      suitePath: ['Payments', 'Cards'],
      comment: 'after the retry',
      ignored: false,
      tags: ['smoke', 'cards'],
    });
    expect({ ...details?.metadata.parameters }).toEqual({ card: 'amex', amount: '12' });
    expect({ ...details?.metadata.fields }).toEqual({
      severity: 'critical',
      description: 'Pays with a card on file',
    });
    expect(details?.problems).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('keeps each attempt and each test apart, whatever order they write in', () => {
    probara.comment('attempt 1');
    running = { ...PAYS, attempt: 2 };
    probara.comment('attempt 2').ignore();
    running = { file: FILE, test: 'cart adds an item', attempt: 1 };
    probara.comment('another test');
    running = { file: '/work/app/tests/login.test.js', test: 'cart pays by card', attempt: 1 };
    probara.comment('another file');

    const cart = channel.take(FILE);
    expect([...cart.keys()]).toHaveLength(3);
    expect(cart.get(attemptKey(FILE, PAYS.test, 1))?.metadata).toMatchObject({
      comment: 'attempt 1',
      ignored: false,
    });
    expect(cart.get(attemptKey(FILE, PAYS.test, 2))?.metadata).toMatchObject({
      comment: 'attempt 2',
      ignored: true,
    });
    expect(cart.get(attemptKey(FILE, 'cart adds an item', 1))?.metadata.comment).toBe(
      'another test',
    );
    // What was taken is gone; the other file waits for its own turn.
    expect(channel.take(FILE).size).toBe(0);
    expect(channel.take('/work/app/tests/login.test.js').size).toBe(1);
  });

  it('warns with the texts of core on a wrong argument, and records nothing of it', () => {
    const untyped = probara as unknown as Record<string, (...args: unknown[]) => unknown>;
    untyped.tags?.(42);
    untyped.title?.(['not', 'a', 'string']);
    untyped.parameters?.({ nested: { no: true } });

    // Warnings reach the reporter as it reads the channel.
    expect(detailsOf()).toBeUndefined();
    expect(warnings.map((warning) => warning.message)).toEqual([
      'probara.tags() takes strings',
      'probara.title() takes a string',
      'probara.parameters() takes an object of strings, numbers or booleans',
    ]);
    expect(warnings[0]).toMatchObject({ file: FILE, test: PAYS.test });
  });

  it('ignores calls while no test runs, with one warning per helper, and still runs a step', () => {
    running = undefined;
    probara.title('from a describe body').title('again').tags('x');
    const value = probara.step('Set up', () => 42);
    void probara.attach({ name: 'log', body: 'text' });

    expect(value).toBe(42);
    expect(channel.take(FILE).size).toBe(0);
    expect(warnings.map((warning) => warning.message)).toEqual([
      'probara.title() only works while a test runs (in a test, or a beforeEach or afterEach hook)',
      'probara.tags() only works while a test runs (in a test, or a beforeEach or afterEach hook)',
      'probara.step() only works while a test runs (in a test, or a beforeEach or afterEach hook)',
      'probara.attach() only works while a test runs (in a test, or a beforeEach or afterEach hook)',
    ]);
    expect(readdirSync(join(channel.dir, 'files'))).toEqual([]);
  });
});

describe('probara without the reporter', () => {
  it('does nothing, silently, and still runs the body of a step', async () => {
    const quiet = createProbara({ channel: () => undefined, currentTest: () => PAYS });
    expect(quiet.title('x').tags('y').ignore()).toBe(quiet);
    expect(quiet.step('Pay', () => 'paid')).toBe('paid');
    await expect(quiet.step('Pay', () => Promise.resolve('paid'))).resolves.toBe('paid');
    expect(() =>
      quiet.step('Pay', () => {
        throw new Error('declined');
      }),
    ).toThrow('declined');
    await expect(quiet.attach({ name: 'gone', path: join(scratch, 'missing') })).resolves.toBe(
      undefined,
    );
    (quiet as unknown as { tags: (value: unknown) => void }).tags(42);
    expect(readdirSync(channel.dir)).toEqual(['files']);
  });
});

describe('probara.step', () => {
  it('returns what its body returns, and records nested steps with their statuses', async () => {
    const total = probara.step('Open the cart', () => {
      probara.step('Load the items');
      return probara.step('Sum the items', () => 3, { expected: 'The total is 3', data: 'a+b' });
    });
    const paid = await probara.step(
      'Pay',
      async () => {
        await probara.step('Enter the card', async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
        return 'paid';
      },
      { expected: 'The order is paid' },
    );

    expect([total, paid]).toEqual([3, 'paid']);
    const details = detailsOf();
    expect(shapeOf(details?.steps)).toEqual([
      {
        action: 'Open the cart',
        status: 'passed',
        steps: [
          { action: 'Load the items', status: 'passed' },
          { action: 'Sum the items', status: 'passed', expected: 'The total is 3', data: 'a+b' },
        ],
      },
      {
        action: 'Pay',
        status: 'passed',
        expected: 'The order is paid',
        steps: [{ action: 'Enter the card', status: 'passed' }],
      },
    ]);
    expect(details?.steps[1]?.durationMs).toBeGreaterThanOrEqual(4);
    // Only the outermost steps are the steps of the case a report creates.
    expect(details?.caseSteps).toEqual([
      { action: 'Open the cart' },
      { action: 'Pay', expected: 'The order is paid' },
    ]);
  });

  it('rethrows the error of its body, sync or async, and records the step as failed', async () => {
    const declined = new Error('Card declined');
    expect(() =>
      probara.step('Pay', () => {
        throw declined;
      }),
    ).toThrow(declined);
    const rejected = new TypeError('No network');
    await expect(
      probara.step('Confirm', async () => {
        await probara.step('Call the bank', () => Promise.reject(rejected));
      }),
    ).rejects.toBe(rejected);

    const steps = detailsOf()?.steps ?? [];
    const stack = (text: string): unknown => expect.stringContaining(text);
    expect(shapeOf(steps)).toEqual([
      {
        action: 'Pay',
        status: 'failed',
        error: { message: 'Card declined', stack: stack('Card declined') },
      },
      {
        action: 'Confirm',
        status: 'failed',
        error: { message: 'No network', stack: stack('TypeError') },
        steps: [
          {
            action: 'Call the bank',
            status: 'failed',
            error: { message: 'No network', stack: stack('No network') },
          },
        ],
      },
    ]);
  });

  it('fails a step whose body never finished before the test ended', () => {
    void probara.step('Wait for the bank', () => new Promise(() => undefined));
    expect(shapeOf(detailsOf()?.steps)).toEqual([
      {
        action: 'Wait for the bank',
        status: 'failed',
        error: { message: 'The step had not finished when the test ended' },
      },
    ]);
  });

  it('warns about a wrong part, records what it can, and still runs the body', () => {
    const untyped = probara.step.bind(probara) as unknown as (...args: unknown[]) => unknown;
    expect(untyped('Pay', () => 1, { expected: 42 })).toBe(1);
    expect(untyped(7, () => 2)).toBe(2);
    expect(untyped('Log in', 'not a function')).toBeUndefined();
    expect(untyped('Log out', undefined, 'expected')).toBeUndefined();

    const steps = detailsOf()?.steps;
    expect(warnings.map((warning) => warning.message)).toEqual([
      'probara.step() takes the expected result as a string',
      'probara.step() takes an action (a string)',
      'probara.step() takes a function as its body',
      'probara.step() takes its options as an object ({ expected, data })',
    ]);
    expect(shapeOf(steps)).toEqual([
      { action: 'Pay', status: 'passed' },
      { action: 'Log in', status: 'passed' },
      { action: 'Log out', status: 'passed' },
    ]);
  });

  it('does not nest a step under a step of another test, left running', () => {
    probara.step('Outer', () => {
      // A step of an earlier test still running while the next test runs.
      running = { file: FILE, test: 'cart adds an item', attempt: 1 };
      probara.step('Inner');
    });
    const details = channel.take(FILE);
    expect(shapeOf(details.get(attemptKey(FILE, 'cart adds an item', 1))?.steps)).toEqual([
      { action: 'Inner', status: 'passed' },
    ]);
    expect(shapeOf(details.get(attemptKey(FILE, PAYS.test, 1))?.steps)).toEqual([
      { action: 'Outer', status: 'passed' },
    ]);
  });
});

describe('probara.attach', () => {
  it('copies a file when called, so a file deleted afterwards is still sent', async () => {
    const path = join(scratch, 'cart.json');
    writeFileSync(path, '{"items":1}');
    await probara.attach({ name: 'cart', path });
    rmSync(path);

    const [file] = detailsOf()?.attachments ?? [];
    expect(file).toMatchObject({
      name: 'cart',
      fileName: 'cart.json',
      contentType: 'application/json',
    });
    expect(readFileSync(file?.path ?? '', 'utf8')).toBe('{"items":1}');
  });

  it('resolves a relative path against the working directory, and keeps a given type', async () => {
    const path = join(scratch, 'shot.bin');
    writeFileSync(path, 'png bytes');
    await probara.attach({
      name: 'screenshot.png',
      path: relative(process.cwd(), path),
      contentType: 'image/png',
    });
    expect(detailsOf()?.attachments).toEqual([
      expect.objectContaining({
        name: 'screenshot.png',
        fileName: 'screenshot.png',
        contentType: 'image/png',
      }),
    ]);
  });

  it('writes a body, text or bytes, and gives text a text type', async () => {
    await probara.attach({ name: 'log', body: 'line 1\n' });
    await probara.attach({
      name: 'bytes',
      body: new Uint8Array([0, 1, 2, 255]),
      contentType: 'application/octet-stream',
    });
    await probara.attach({ name: 'buffer', body: Buffer.from('abc') });

    const files = detailsOf()?.attachments ?? [];
    expect(
      files.map(({ name, fileName, contentType }) => ({ name, fileName, contentType })),
    ).toEqual([
      { name: 'log', fileName: 'log', contentType: 'text/plain' },
      { name: 'bytes', fileName: 'bytes', contentType: 'application/octet-stream' },
      { name: 'buffer', fileName: 'buffer', contentType: undefined },
    ]);
    expect(files.map((file) => [...readFileSync(file.path ?? '')])).toEqual([
      [...Buffer.from('line 1\n')],
      [0, 1, 2, 255],
      [...Buffer.from('abc')],
    ]);
  });

  it('gives a file attached inside a step to that step', async () => {
    await probara.step('Pay', async () => {
      await probara.attach({ name: 'receipt', body: 'paid' });
    });
    await probara.attach({ name: 'after', body: 'done' });
    const details = detailsOf();
    expect(shapeOf(details?.steps)).toEqual([
      { action: 'Pay', status: 'passed', attachments: ['receipt'] },
    ]);
    expect(details?.attachments.map((file) => file.name)).toEqual(['after']);
  });

  it('warns with the name of a file it cannot attach, and never throws', async () => {
    await expect(
      probara.attach({ name: 'gone', path: join(scratch, 'missing.txt') }),
    ).resolves.toBeUndefined();
    await (probara.attach as (value: unknown) => Promise<void>)('nope');
    await (probara.attach as (value: unknown) => Promise<void>)({ name: 'empty' });
    expect(detailsOf()).toBeUndefined();
    expect(warnings.map((warning) => warning.message)).toEqual([
      expect.stringMatching(/^probara\.attach\(\) could not attach "gone": ENOENT/),
      'probara.attach() takes { name, path } or { name, body }',
      'probara.attach() could not attach "empty": it has neither a path nor a body',
    ]);
  });
});

describe('probara with a channel that went away', () => {
  it('never throws into the test', () => {
    channel.close();
    expect(() => probara.title('x').comment('y')).not.toThrow();
    expect(probara.step('Pay', () => 1)).toBe(1);
  });
});
