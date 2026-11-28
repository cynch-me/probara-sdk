/**
 * The module of a stack frame, as grouping reads it beside the function: a dependency's path from
 * its `node_modules` folder (`express/lib/router/index`), or an app file's path from the app root
 * (`src/routes/orders`), without the file extension and with `/` separators on every OS.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ProbaraEvent, StackFrame } from '@probara/error-core';

const EXTENSION = /\.(?:[cm]?[jt]s|jsx|tsx)$/;

function slashed(path: string): string {
  return path.replace(/\\/g, '/');
}

function pathOf(filename: string): string | null {
  if (filename.startsWith('file:')) {
    try {
      return slashed(fileURLToPath(filename));
    } catch {
      return null;
    }
  }
  if (filename.startsWith('/') || /^[a-z]:[\\/]/i.test(filename)) return slashed(filename);
  return null;
}

function decoded(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** The app root and its real path, each ending with `/`. */
function rootsOf(appRoot: string): string[] {
  const roots = [appRoot];
  try {
    roots.push(realpathSync(appRoot));
  } catch {
    // A root that cannot be resolved is matched as given.
  }
  return [...new Set(roots.map((root) => slashed(root).replace(/\/?$/, '/')))];
}

/** The module of a frame in `filename`; `undefined` for runtime internals. */
export function moduleOf(filename: string, roots: readonly string[]): string | undefined {
  const path = pathOf(filename);
  if (path === null) return undefined;
  const bare = decoded(path.replace(EXTENSION, ''));
  const dependency = bare.lastIndexOf('/node_modules/');
  if (dependency !== -1) return bare.slice(dependency + '/node_modules/'.length);
  const root = roots.find((candidate) => bare.startsWith(candidate));
  if (root !== undefined) return bare.slice(root.length);
  return bare.slice(bare.lastIndexOf('/') + 1);
}

/** Adds `module` to the frames of events that have none, from `appRoot`. */
export function createModuleNames(appRoot: string): (event: ProbaraEvent) => ProbaraEvent {
  const roots = rootsOf(appRoot);
  const named = (frame: StackFrame): StackFrame => {
    if (frame.module !== undefined || frame.filename === undefined) return frame;
    const module = moduleOf(frame.filename, roots);
    return module === undefined || module === '' ? frame : { ...frame, module };
  };
  return (event) => {
    const values = event.exception?.values;
    if (values === undefined) return event;
    return {
      ...event,
      exception: {
        values: values.map((value) =>
          value.stacktrace === undefined
            ? value
            : {
                ...value,
                stacktrace: { ...value.stacktrace, frames: value.stacktrace.frames.map(named) },
              },
        ),
      },
    };
  };
}
