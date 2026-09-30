/**
 * `captureOutput` in a test process: while a test runs (from the setup file's root `beforeEach` to
 * its root `afterEach`), the console methods of the test sandbox are wrapped; what the test writes
 * with them is recorded, and still printed by Jest's console. At the end of the test it is attached
 * to that attempt as the Playwright reporter attaches a test's output: `stdout.log` (`console.log`,
 * `info`, `debug`) and `stderr.log` (`console.warn`, `error`), `text/plain`, each only when not
 * empty, and cut at 32 MiB (the most an attachment holds) with a line saying so. Loaded inside the
 * test sandbox: Node built-ins only.
 *
 * Jest runs no `beforeEach` or `afterEach` for a `test.concurrent` test: its output is never
 * captured, and what it writes while another test runs is left out of that test's.
 */
// Node's own: the test sandbox of jest-environment-jsdom has no global `TextEncoder`.
import { format, TextEncoder } from 'node:util';
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
 * The most a stream's attachment holds, in bytes: core's `MAX_ATTACHMENT_BYTES` (a larger file is
 * refused when it is uploaded), which this module cannot import (Node built-ins only).
 */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/** The last line of an output cut at {@link MAX_OUTPUT_BYTES}. */
const CUT_MARKER =
  '[probara] The output of this test was cut here: an attachment holds at most 32 MiB\n';

/** What a stream of an attempt recorded: its text, its size in bytes, and whether it is full. */
interface StreamOutput {
  text: string;
  bytes: number;
  full: boolean;
}

/**
 * `text` added to `output`, up to {@link MAX_OUTPUT_BYTES}: the output that would go beyond is cut
 * at a whole character and ends with {@link CUT_MARKER}, and nothing more is added after it.
 */
function append(output: StreamOutput, text: string): void {
  const size = Buffer.byteLength(text);
  if (output.bytes + size <= MAX_OUTPUT_BYTES) {
    output.text += text;
    output.bytes += size;
    return;
  }
  // Room for the marker on a line of its own.
  const room = new Uint8Array(MAX_OUTPUT_BYTES - Buffer.byteLength(CUT_MARKER) - 1);
  // Whole characters only: `read` never ends inside one.
  const { read } = new TextEncoder().encodeInto(output.text + text, room);
  const kept = (output.text + text).slice(0, read);
  output.text = `${kept}${kept.endsWith('\n') ? '' : '\n'}${CUT_MARKER}`;
  output.bytes = Buffer.byteLength(output.text);
  output.full = true;
}

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
        output: Record<Stream, StreamOutput>;
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
          output: {
            stdout: { text: '', bytes: 0, full: false },
            stderr: { text: '', bytes: 0, full: false },
          },
          wrappers: new Map<Method, { wrapper: ConsoleMethod; original: ConsoleMethod }>(),
        };
        for (const method of Object.keys(STREAMS) as Method[]) {
          const original = target[method];
          if (typeof original !== 'function') continue;
          const wrapper = makeWrapper(original as ConsoleMethod, (args) => {
            // Only while this attempt is captured, and only what it writes itself.
            if (current !== capture) return;
            try {
              const output = capture.output[STREAMS[method]];
              // A full stream is not formatted again: the console prints the message all the same.
              if (output.full || !sameAttempt(test, context.currentTest())) return;
              append(output, `${format(...Array.from(args))}\n`);
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
          const { text } = capture.output[stream];
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
