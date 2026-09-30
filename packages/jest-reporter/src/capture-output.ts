/**
 * `captureOutput` in a test process: while a test runs (from the setup file's root `beforeEach` to
 * its root `afterEach`), the console methods of the test sandbox are wrapped; what the test writes
 * with them is recorded, and still printed by Jest's console. At the end of the test it is attached
 * to that attempt as the Playwright reporter attaches a test's output: `stdout.log` (`console.log`,
 * `info`, `debug`) and `stderr.log` (`console.warn`, `error`), `text/plain`, each only when not
 * empty. Loaded inside the test sandbox: Node built-ins only.
 *
 * Jest runs no `beforeEach` or `afterEach` for a `test.concurrent` test: its output is never
 * captured, and what it writes while another test runs is left out of that test's.
 */
import { format } from 'node:util';
import { runInThisContext } from 'node:vm';
import { attachText } from './channel.js';
import type { CurrentTest } from './current-test.js';

/** The stream of each captured console method, as Node's console writes them. */
const STREAMS = {
  log: 'stdout',
  info: 'stdout',
  debug: 'stdout',
  warn: 'stderr',
  error: 'stderr',
} as const;

type Method = keyof typeof STREAMS;
type Stream = (typeof STREAMS)[Method];

/** The attachment of each stream: Playwright's names and content type. */
const ATTACHMENTS: Readonly<Record<Stream, string>> = {
  stdout: 'stdout.log',
  stderr: 'stderr.log',
};

type ConsoleMethod = (...args: unknown[]) => unknown;

/**
 * Makes the wrapper of a console method. Jest prints, under each message, the line of the code that
 * called the console (the first frame of the call's stack it does not filter out): the wrapper's
 * frame must be one it filters, or every message would point at this file. Jest leaves out the
 * frames of Node's own modules (`internal/...`), so the wrapper is compiled under such a name, which
 * still says whose it is.
 */
const makeWrapper = runInThisContext(
  `(function (original, record) {
  return function () {
    record(arguments);
    return original.apply(this, arguments);
  };
})`,
  { filename: 'internal/@probara/jest-reporter/capture-output' },
) as (original: ConsoleMethod, record: (args: ArrayLike<unknown>) => void) => ConsoleMethod;

export interface OutputCaptureContext {
  /** The console of the test sandbox. */
  console: object;
  /** The channel directory, while the reporter runs; `undefined` captures nothing. */
  channel(): string | undefined;
  /** The test attempt running now, if any. */
  currentTest(): CurrentTest | undefined;
}

/** The hooks of the capture: `start()` in a root `beforeEach`, `stop()` in a root `afterEach`. */
export interface OutputCapture {
  start(): void;
  stop(): void;
}

function sameAttempt(a: CurrentTest, b: CurrentTest | undefined): boolean {
  return b !== undefined && a.file === b.file && a.test === b.test && a.attempt === b.attempt;
}

/** A capture of the output of each test attempt, on `context`'s console. Never throws. */
export function createOutputCapture(context: OutputCaptureContext): OutputCapture {
  const target = context.console as Record<string, unknown>;
  /** The attempt being captured, its channel and output, and the wrappers in place. */
  let current:
    | {
        dir: string;
        test: CurrentTest;
        output: Record<Stream, string>;
        wrappers: Map<Method, { wrapper: ConsoleMethod; original: ConsoleMethod }>;
      }
    | undefined;

  return {
    start() {
      try {
        const dir = context.channel();
        const test = dir === undefined ? undefined : context.currentTest();
        if (dir === undefined || test === undefined) return;
        const capture = {
          dir,
          test,
          output: { stdout: '', stderr: '' },
          wrappers: new Map<Method, { wrapper: ConsoleMethod; original: ConsoleMethod }>(),
        };
        for (const method of Object.keys(STREAMS) as Method[]) {
          const original = target[method];
          if (typeof original !== 'function') continue;
          const wrapper = makeWrapper(original as ConsoleMethod, (args) => {
            // Only while this attempt is captured, and only what it writes itself.
            if (current !== capture) return;
            try {
              if (!sameAttempt(test, context.currentTest())) return;
              capture.output[STREAMS[method]] += `${format(...Array.from(args))}\n`;
            } catch {
              // The message is still printed; only its copy is lost.
            }
          });
          target[method] = wrapper;
          capture.wrappers.set(method, { wrapper, original: original as ConsoleMethod });
        }
        current = capture;
      } catch {
        // Nothing is captured for this test.
      }
    },
    stop() {
      const capture = current;
      current = undefined;
      if (capture === undefined) return;
      try {
        for (const [method, { wrapper, original }] of capture.wrappers) {
          // A method the test replaced (`jest.spyOn(console, 'log')`) is the test's to restore: the
          // wrapper under it only prints from now on.
          if (target[method] === wrapper) target[method] = original;
        }
        for (const stream of ['stdout', 'stderr'] as const) {
          const text = capture.output[stream];
          if (text === '') continue;
          attachText(capture.dir, capture.test, {
            name: ATTACHMENTS[stream],
            contentType: 'text/plain',
            text,
          });
        }
      } catch {
        // The channel is gone: the output of this test is lost, never the test.
      }
    },
  };
}
