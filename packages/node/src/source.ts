/**
 * Source context for in-app frames: the lines around each frame's line, read from disk, with the
 * files read kept in a small cache.
 */
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProbaraEvent, StackFrame } from '@probara/error-core';

/** Lines added before and after a frame's line. */
export const CONTEXT_LINES = 5;

/** Files larger than this are never read: bundles, generated code. */
export const MAX_SOURCE_FILE_BYTES = 1024 * 1024;

/** How many files' lines are kept. */
const CACHE_SIZE = 50;

/** Characters of a line kept, so a minified line never fills an event. */
const MAX_LINE_LENGTH = 1024;

function pathOf(filename: string): string | null {
  try {
    if (filename.startsWith('file://')) return fileURLToPath(filename);
  } catch {
    return null;
  }
  return isAbsolute(filename) ? filename : null;
}

/** Adds the source lines around their line to the in-app frames of events. */
export function createSourceContext(): (event: ProbaraEvent) => ProbaraEvent {
  const cache = new Map<string, string[] | null>();

  function linesOf(path: string): string[] | null {
    if (cache.has(path)) {
      const lines = cache.get(path) ?? null;
      cache.delete(path);
      cache.set(path, lines);
      return lines;
    }
    let lines: string[] | null = null;
    try {
      if (statSync(path).size <= MAX_SOURCE_FILE_BYTES) {
        lines = readFileSync(path, 'utf8')
          .split(/\r?\n/)
          .map((line) => line.slice(0, MAX_LINE_LENGTH));
      }
    } catch {
      lines = null;
    }
    cache.set(path, lines);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    return lines;
  }

  function withContext(frame: StackFrame): StackFrame {
    if (frame.in_app !== true || frame.lineno === undefined || frame.filename === undefined)
      return frame;
    const path = pathOf(frame.filename);
    if (path === null) return frame;
    const lines = linesOf(path);
    const index = frame.lineno - 1;
    const line = lines?.[index];
    if (lines === null || line === undefined) return frame;
    return {
      ...frame,
      pre_context: lines.slice(Math.max(0, index - CONTEXT_LINES), index),
      context_line: line,
      post_context: lines.slice(index + 1, index + 1 + CONTEXT_LINES),
    };
  }

  return (event) => {
    if (event.exception === undefined) return event;
    return {
      ...event,
      exception: {
        values: event.exception.values.map((value) =>
          value.stacktrace === undefined
            ? value
            : { ...value, stacktrace: { frames: value.stacktrace.frames.map(withContext) } },
        ),
      },
    };
  };
}
