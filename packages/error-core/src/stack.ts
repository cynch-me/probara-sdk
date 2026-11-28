/**
 * Stack traces of V8 (Chrome, Edge, Node), SpiderMonkey (Firefox) and JavaScriptCore (Safari) read
 * into frames, outermost first and the crashing frame last, as the Probara ingest expects.
 */
import type { StackFrame } from './types.js';

/** The most frames read from one stack; the crashing end is kept. */
export const MAX_STACK_FRAMES = 100;

/** `at fn (location)`, `at location`, `at async fn (location)`, `at new Fn (location)`. */
const V8_FRAME = /^\s*at (?:async )?(?:(.+?) \((.+)\)|(.+))$/;

/** `fn@location` or `@location`. */
const AT_FRAME = /^\s*([^@]*)@(.+)$/;

/** A location: `<file>:<line>:<column>`, line and column optional. */
const LOCATION = /^(.*?)(?::(\d+))?(?::(\d+))?$/;

/** What a frame's file must look like: a URL, a path, or a runtime's own marker. */
const FILE = /^(?:[a-z][a-z0-9+.-]*:|\/|[a-z]:\\|\[native code\]|<anonymous>)/i;

/** Files that are never the app's: runtime internals, dependencies and browser extensions. */
const NOT_IN_APP =
  /^(?:node:|internal\/|native|\[native code\]|<anonymous>|(?:chrome|moz|safari|safari-web|ms-browser)-extension:)|[\\/]node_modules[\\/]/i;

/** Whether a frame in `filename` is the app's own code. */
export function isInApp(filename: string): boolean {
  return !NOT_IN_APP.test(filename);
}

function frameAt(name: string | undefined, location: string): StackFrame | null {
  const trimmed = location.trim();
  // Firefox writes code run by eval as `<file> line <n> > eval`: the frame is the eval's caller.
  const evaluated = / line (\d+) > (?:eval|Function)/.exec(trimmed);
  const [, file = '', line, column] =
    LOCATION.exec(evaluated === null ? trimmed : trimmed.slice(0, evaluated.index)) ?? [];
  if (!FILE.test(file)) return null;
  const frame: StackFrame = {
    filename: file,
    function: name === undefined || name.trim() === '' ? '?' : name.trim(),
  };
  const lineno = evaluated?.[1] ?? line;
  if (lineno !== undefined) frame.lineno = Number(lineno);
  if (column !== undefined && evaluated === null) frame.colno = Number(column);
  frame.in_app = isInApp(file);
  return frame;
}

function parseLine(line: string): StackFrame | null {
  const v8 = V8_FRAME.exec(line);
  if (v8 !== null) {
    const [, name, wrapped, bare] = v8;
    return frameAt(name, wrapped ?? bare ?? '');
  }
  const at = AT_FRAME.exec(line);
  if (at !== null) return frameAt(at[1], at[2] ?? '');
  return null;
}

/** The frames of `stack`, outermost first; empty when it holds none. */
export function parseStackTrace(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n')) {
    const frame = parseLine(line);
    if (frame !== null) frames.push(frame);
    if (frames.length >= MAX_STACK_FRAMES) break;
  }
  return frames.reverse();
}
