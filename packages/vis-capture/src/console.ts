/**
 * Console capture: every console level, uncaught errors and unhandled rejections of the page,
 * recorded into a session as console entries. It never throws into the page, calls the original
 * console method exactly once per call, and puts the originals back on stop.
 */
import { CONSOLE_LEVELS, type ConsoleEntry, type ConsoleLevel } from './entries.js';
import { sanitizeConsoleEntry, type LogSanitizer } from './sanitize.js';
import { serializeArgument, type SerializeOptions } from './serialize.js';
import type { RecordingSession } from './session.js';

/** The window whose console and errors are captured: `globalThis` unless another is given. */
export interface ConsoleCaptureTarget {
  console: Console;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface ConsoleCaptureOptions {
  logSanitizer?: LogSanitizer;
  /** Limits of each serialized argument. */
  serialize?: SerializeOptions;
  target?: ConsoleCaptureTarget;
}

export interface ConsoleCapture {
  readonly active: boolean;
  /** Patches the console and listens to the window; does nothing when already active. */
  start(): void;
  /** Restores the console methods and stops listening. */
  stop(): void;
}

type ConsoleMethod = (...args: unknown[]) => void;

/** What a console entry holds beyond its time and level. */
interface Content {
  args: string[];
  stack?: string | undefined;
  source?: string | undefined;
}
type Fields = Record<string, unknown>;

function isErrorLike(value: unknown): value is Fields {
  if (typeof value !== 'object' || value === null) return false;
  if (Object.prototype.toString.call(value) === '[object Error]') return true;
  const fields = value as Fields;
  return typeof fields['name'] === 'string' && typeof fields['message'] === 'string';
}

/** The headline the browser console shows for a thrown value. */
function thrownText(value: unknown, options: SerializeOptions | undefined): string {
  if (isErrorLike(value)) {
    const name = typeof value['name'] === 'string' ? value['name'] : 'Error';
    const message = typeof value['message'] === 'string' ? value['message'] : '';
    return message === '' ? name : `${name}: ${message}`;
  }
  return serializeArgument(value, options);
}

function stackOf(value: unknown): string | undefined {
  if (!isErrorLike(value)) return undefined;
  return typeof value['stack'] === 'string' ? value['stack'] : undefined;
}

/** The stack of a console call, from its caller: the header and the wrapper's frame removed. */
function callerStack(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const lines = raw.split('\n');
  // V8 starts with the "Error" line; every engine then lists the wrapper's own frame.
  if (lines[0]?.trim() === 'Error') lines.shift();
  lines.shift();
  const stack = lines.map((line) => line.trim()).filter((line) => line !== '');
  return stack.length === 0 ? undefined : stack.join('\n');
}

export function createConsoleCapture(
  session: RecordingSession,
  options: ConsoleCaptureOptions = {},
): ConsoleCapture {
  const target: ConsoleCaptureTarget = options.target ?? globalThis;
  const patched = new Map<ConsoleLevel, { original: ConsoleMethod; wrapper: ConsoleMethod }>();
  let active = false;
  /** Set while recording: a console call made meanwhile (by a sanitizer) is not recorded. */
  let busy = false;

  function record(level: ConsoleLevel, content: () => Content): void {
    if (busy || session.state !== 'recording') return;
    busy = true;
    try {
      const { args, stack, source } = content();
      const entry: ConsoleEntry = { ...session.stamp(), level, args };
      if (stack !== undefined) entry.stack = stack;
      if (source !== undefined) entry.source = source;
      const kept = sanitizeConsoleEntry(entry, options.logSanitizer);
      if (kept !== null) session.record('console', kept);
    } catch {
      // Capture never breaks the page.
    } finally {
      busy = false;
    }
  }

  function wrap(level: ConsoleLevel, original: ConsoleMethod): ConsoleMethod {
    const console = target.console;
    return function captured(...args: unknown[]): void {
      if (active) {
        // Taken here, so the first frame below the wrapper's own is the caller's.
        let raw: string | undefined;
        try {
          raw = new Error().stack;
        } catch {
          raw = undefined;
        }
        record(level, () => ({
          args: args.map((arg) => serializeArgument(arg, options.serialize)),
          stack: callerStack(raw),
        }));
      }
      original.apply(console, args);
    };
  }

  const onError = (event: Event): void => {
    const fields = event as unknown as Fields;
    // Failed resource loads also fire "error"; only script errors carry a message.
    if (typeof fields['message'] !== 'string') return;
    record('error', () => {
      const error = fields['error'];
      const message = fields['message'] as string;
      const headline =
        error === undefined || error === null
          ? message.replace(/^Uncaught /, '')
          : thrownText(error, options.serialize);
      const filename = typeof fields['filename'] === 'string' ? fields['filename'] : '';
      return {
        args: [`Uncaught ${headline}`],
        stack: stackOf(error),
        source:
          filename === ''
            ? undefined
            : `${filename}:${String(fields['lineno'])}:${String(fields['colno'])}`,
      };
    });
  };

  const onRejection = (event: Event): void => {
    const reason = (event as unknown as Fields)['reason'];
    record('error', () => ({
      args: [`Uncaught (in promise) ${thrownText(reason, options.serialize)}`],
      stack: stackOf(reason),
    }));
  };

  return {
    get active() {
      return active;
    },
    start() {
      if (active) return;
      try {
        const console = target.console as unknown as Record<string, unknown>;
        for (const level of CONSOLE_LEVELS) {
          const original = console[level];
          if (typeof original !== 'function') continue;
          const wrapper = wrap(level, original as ConsoleMethod);
          console[level] = wrapper;
          patched.set(level, { original: original as ConsoleMethod, wrapper });
        }
        target.addEventListener('error', onError);
        target.addEventListener('unhandledrejection', onRejection);
      } catch {
        // A frozen console or a window without events: capture what could be patched.
      }
      active = true;
    },
    stop() {
      if (!active) return;
      active = false;
      try {
        const console = target.console as unknown as Record<string, unknown>;
        for (const [level, { original, wrapper }] of patched) {
          // Code that wrapped the console after us keeps its wrapper; ours, inactive, calls through.
          if (console[level] === wrapper) console[level] = original;
        }
        target.removeEventListener('error', onError);
        target.removeEventListener('unhandledrejection', onRejection);
      } catch {
        // Never throw into the page.
      }
      patched.clear();
    },
  };
}
