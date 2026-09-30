/**
 * `captureOutput` in a test process: what the setup file's hooks capture of the console while a
 * test runs, read back as the reporter reads the channel, and that the console still prints it all.
 */
import { readFileSync } from 'node:fs';
import { MAX_ATTACHMENT_BYTES } from '@probara/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOutputCapture, type OutputCapture } from './capture-output.js';
import { attemptKey } from './channel.js';
import { createChannel, type AttemptDetails, type Channel } from './channel-reader.js';
import type { CurrentTest } from './current-test.js';

const FILE = '/work/app/tests/cart.test.js';
const PAYS: CurrentTest = { file: FILE, test: 'cart pays by card', attempt: 1 };
const ADDS: CurrentTest = { file: FILE, test: 'cart adds an item', attempt: 1 };

/** A console like Jest's: each method records what it was given. */
function fakeConsole() {
  const printed: [string, unknown[]][] = [];
  const methods = ['log', 'info', 'debug', 'warn', 'error', 'dir'] as const;
  const console: Record<string, (...args: unknown[]) => void> = {};
  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      printed.push([method, args]);
    };
  }
  return { console, printed, originals: { ...console } };
}

let channel: Channel;
let running: CurrentTest | undefined;
let jest: ReturnType<typeof fakeConsole>;
let capture: OutputCapture;

beforeEach(() => {
  channel = createChannel(() => undefined);
  running = PAYS;
  jest = fakeConsole();
  capture = createOutputCapture({
    console: jest.console,
    channel: () => channel.dir,
    currentTest: () => running,
  });
});

afterEach(() => {
  channel.close();
  vi.unstubAllGlobals();
});

function detailsOf(test: CurrentTest = PAYS): AttemptDetails | undefined {
  return channel.take(test.file).get(attemptKey(test.file, test.test, test.attempt));
}

/** The attached files of `details`: name, content type and content. */
function filesOf(details: AttemptDetails | undefined) {
  return (details?.attachments ?? []).map((file) => ({
    name: file.name,
    contentType: file.contentType,
    content: readFileSync(file.path ?? '', 'utf8'),
  }));
}

describe('createOutputCapture', () => {
  it('stops recording a stream at the most an attachment holds, with a line saying so', () => {
    const chunk = 'é'.repeat(6 * 1024 * 1024); // 12 MiB
    capture.start();
    for (let index = 0; index < 4; index += 1) jest.console.log?.(chunk);
    jest.console.log?.('Done');
    jest.console.error?.('Slow');
    capture.stop();

    const [stdout, stderr] = filesOf(detailsOf());
    const marker =
      '[probara] The output of this test was cut here: an attachment holds at most 32 MiB\n';
    expect(Buffer.byteLength(stdout?.content ?? '')).toBeLessThanOrEqual(MAX_ATTACHMENT_BYTES);
    expect(stdout?.content.endsWith(`é\n${marker}`)).toBe(true);
    expect(stdout?.content.startsWith(`${chunk}\n${chunk}\n`)).toBe(true);
    expect(stdout?.content).not.toContain('\uFFFD');
    expect(stderr?.content).toBe('Slow\n');
    // The console still printed it all.
    expect(jest.printed.map(([method]) => method)).toEqual([
      'log',
      'log',
      'log',
      'log',
      'log',
      'error',
    ]);
  });

  it('cuts a stream in a sandbox without a global TextEncoder (jest-environment-jsdom has none)', () => {
    vi.stubGlobal('TextEncoder', undefined);
    const chunk = 'x'.repeat(20 * 1024 * 1024);
    capture.start();
    jest.console.log?.(chunk);
    jest.console.log?.(chunk);
    jest.console.log?.('Done');
    capture.stop();

    const [stdout] = filesOf(detailsOf());
    expect(Buffer.byteLength(stdout?.content ?? '')).toBe(MAX_ATTACHMENT_BYTES);
    expect(
      stdout?.content.endsWith(
        `x\n[probara] The output of this test was cut here: an attachment holds at most 32 MiB\n`,
      ),
    ).toBe(true);
  });

  it('keeps the whole output of a stream that fits in an attachment', () => {
    const line = 'x'.repeat(MAX_ATTACHMENT_BYTES - 1);
    capture.start();
    jest.console.log?.(line);
    capture.stop();

    expect(Buffer.byteLength(filesOf(detailsOf())[0]?.content ?? '')).toBe(MAX_ATTACHMENT_BYTES);
  });

  it('attaches what a test wrote to the console as stdout.log and stderr.log, like Playwright', () => {
    capture.start();
    jest.console.log?.('Opening the cart');
    jest.console.info?.('%d items', 3);
    jest.console.error?.('Slow response:', 2.1, 's');
    jest.console.debug?.({ sku: 42 });
    jest.console.warn?.('Retrying');
    capture.stop();

    expect(filesOf(detailsOf())).toEqual([
      {
        name: 'stdout.log',
        contentType: 'text/plain',
        content: 'Opening the cart\n3 items\n{ sku: 42 }\n',
      },
      {
        name: 'stderr.log',
        contentType: 'text/plain',
        content: 'Slow response: 2.1 s\nRetrying\n',
      },
    ]);
  });

  it('still prints everything on the console, and gives the console back after the test', () => {
    capture.start();
    jest.console.log?.('Opening the cart', 1);
    jest.console.error?.('Slow');
    capture.stop();
    jest.console.log?.('After the test');

    expect(jest.printed).toEqual([
      ['log', ['Opening the cart', 1]],
      ['error', ['Slow']],
      ['log', ['After the test']],
    ]);
    expect(jest.console).toEqual(jest.originals);
    expect(filesOf(detailsOf()).map((file) => file.content)).toEqual([
      'Opening the cart 1\n',
      'Slow\n',
    ]);
  });

  it('attaches only the streams a test wrote to, to the attempt that ran, attempt by attempt', () => {
    running = { ...PAYS, attempt: 2 };
    capture.start();
    jest.console.warn?.('Second try');
    capture.stop();
    running = ADDS;
    capture.start();
    capture.stop();

    expect(filesOf(detailsOf({ ...PAYS, attempt: 2 }))).toEqual([
      { name: 'stderr.log', contentType: 'text/plain', content: 'Second try\n' },
    ]);
    expect(detailsOf(ADDS)).toBeUndefined();
  });

  it('leaves out what another test writes meanwhile (a test.concurrent body still running)', () => {
    capture.start();
    jest.console.log?.('Mine');
    running = ADDS;
    jest.console.log?.('Not mine');
    running = PAYS;
    capture.stop();

    expect(filesOf(detailsOf()).map((file) => file.content)).toEqual(['Mine\n']);
    expect(jest.printed.map(([, args]) => args[0])).toEqual(['Mine', 'Not mine']);
  });

  it('captures nothing outside a test, nor without the reporter', () => {
    running = undefined;
    capture.start();
    jest.console.log?.('In a describe body');
    capture.stop();
    expect(jest.console).toEqual(jest.originals);

    const off = createOutputCapture({
      console: jest.console,
      channel: () => undefined,
      currentTest: () => PAYS,
    });
    off.start();
    expect(jest.console).toEqual(jest.originals);
    off.stop();
    expect(channel.take(FILE).size).toBe(0);
  });

  it('keeps a console method the test replaced (jest.spyOn), and stops capturing through it', () => {
    capture.start();
    const spy = (...args: unknown[]) => {
      jest.printed.push(['spy', args]);
    };
    const wrapped = jest.console.log as (...args: unknown[]) => void;
    jest.console.log = spy;
    jest.console.error?.('Before the end');
    capture.stop();
    expect(jest.console.log).toBe(spy);
    expect(jest.console.error).toBe(jest.originals.error);

    // The spy restored later puts the wrapper back: it only prints.
    jest.console.log = wrapped;
    running = ADDS;
    capture.start();
    capture.stop();
    jest.console.log('Later');
    expect(jest.printed.at(-1)).toEqual(['log', ['Later']]);
    const details = channel.take(FILE);
    expect(
      filesOf(details.get(attemptKey(FILE, PAYS.test, 1))).map((file) => file.content),
    ).toEqual(['Before the end\n']);
    expect(details.has(attemptKey(FILE, ADDS.test, 1))).toBe(false);
  });

  it('never throws into the test when the channel is gone', () => {
    const gone = createOutputCapture({
      console: jest.console,
      channel: () => '/no/such/channel',
      currentTest: () => PAYS,
    });
    gone.start();
    jest.console.log?.('Lost');
    expect(() => {
      gone.stop();
    }).not.toThrow();
    expect(jest.console).toEqual(jest.originals);
  });
});
