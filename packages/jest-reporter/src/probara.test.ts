/**
 * `probara.*` in a test process, read back as the reporter reads the channel: what each helper
 * records for the running attempt, the warnings it gives, and that it never breaks a test.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { TestStepInput } from '@probara/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('records the links and issues of the running attempt in call order, chaining', () => {
    const chained = probara
      .link('https://ci.example.com/build/12', 'Build')
      .issue(' SHOP-7 ')
      .link('https://example.com/spec');
    expect(chained).toBe(probara);

    expect(detailsOf()?.metadata.links).toEqual([
      { url: 'https://ci.example.com/build/12', name: 'Build' },
      { issue: 'SHOP-7' },
      { url: 'https://example.com/spec' },
    ]);
    expect(warnings).toEqual([]);
  });

  it('warns with the texts of core on a wrong link or issue, and records neither', () => {
    probara.link('ci.example.com/build/12').link('https://example.com', 42 as unknown as string);
    probara.issue('  ');

    expect(detailsOf()).toBeUndefined();
    expect(warnings.map((warning) => warning.message)).toEqual([
      'probara.link() takes an absolute http(s) URL of at most 2048 characters',
      'probara.link() takes the name as a string',
      'probara.issue() takes an issue id (a string), such as PRB-7',
    ]);
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

describe('probara under a test runner other than jest-circus', () => {
  it('warns once that it needs jest-circus, rather than that no test runs', () => {
    const problem = "probara.* needs jest-circus, Jest's default test runner";
    const jasmine = createProbara({
      channel: () => channel.dir,
      currentTest: () => undefined,
      runnerProblem: () => problem,
    });
    jasmine.title('x').tags('y');
    expect(jasmine.step('Pay', () => 'paid')).toBe('paid');

    // Warnings reach the reporter as it reads the channel.
    expect(channel.take(FILE).size).toBe(0);
    expect(warnings.map((warning) => warning.message)).toEqual([problem]);
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

  it('returns the very promise its body returns, and records the step once it settles', async () => {
    const paid = Promise.resolve('paid');
    const declined = Promise.reject(new Error('Card declined'));
    expect(probara.step('Pay', () => paid)).toBe(paid);
    const retried = probara.step('Retry', () => declined);
    expect(retried).toBe(declined);
    await expect(retried).rejects.toThrow('Card declined');
    await new Promise((resolve) => setImmediate(resolve));

    expect(shapeOf(detailsOf()?.steps)).toEqual([
      { action: 'Pay', status: 'passed' },
      {
        action: 'Retry',
        status: 'failed',
        error: {
          message: 'Card declined',
          stack: expect.stringContaining('Card declined') as unknown,
        },
      },
    ]);
  });

  it('returns a thenable that is no promise as is, never calling its then(), which may start it', () => {
    // Like a supertest request: then() sends it, and the test chains more calls first.
    const then = vi.fn();
    const request = {
      then,
      expect: (status: number) => (status === 200 ? request : undefined),
    };
    const returned = probara.step('Call the API', () => request);

    expect(returned).toBe(request);
    expect(returned.expect(200)).toBe(request);
    expect(then).not.toHaveBeenCalled();
    expect(shapeOf(detailsOf()?.steps)).toEqual([{ action: 'Call the API', status: 'passed' }]);
  });

  it('nests the steps of every copy of the helpers a test loads (jest.isolateModules)', () => {
    const copy = createProbara({ channel: () => channel.dir, currentTest: () => running });
    probara.step('Outer', () => {
      copy.step('Inner');
    });
    expect(shapeOf(detailsOf()?.steps)).toEqual([
      { action: 'Outer', status: 'passed', steps: [{ action: 'Inner', status: 'passed' }] },
    ]);
  });

  it('does not nest a step under a step of another test, left running', () => {
    probara.step('Outer', () => {
      // A step of an earlier test still running while the next test runs.
      running = { file: FILE, test: 'cart adds an item', attempt: 1 };
      probara.step('Inner');
    });
    const lines = readdirSync(channel.dir)
      .filter((name) => name.endsWith('.jsonl'))
      .flatMap((name) => readFileSync(join(channel.dir, name), 'utf8').trim().split('\n'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    // The test process gives it no parent: that step belongs to another attempt.
    expect(lines.find((line) => line.action === 'Inner')).not.toHaveProperty('parent');
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
