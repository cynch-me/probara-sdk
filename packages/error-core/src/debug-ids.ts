/**
 * Debug IDs of the files `probara sourcemaps inject` prepared: its snippet registers the stack of
 * an error made in each file under `globalThis._probaraDebugIds`, with the file's debug ID. The
 * innermost frame of that stack names the file as this runtime writes it, so it matches the frames
 * of the events, in browsers and in Node bundles alike.
 */
import { parseStackTrace } from './stack.js';
import type { DebugImage, ProbaraEvent } from './types.js';

type Registry = Record<string, unknown>;

interface Resolved {
  registry: Registry | undefined;
  /** Keys of `registry` read so far: a key is parsed once. */
  count: number;
  read: Set<string>;
  byFile: Map<string, string>;
}

let resolved: Resolved = { registry: undefined, count: 0, read: new Set(), byFile: new Map() };

function registryNow(): Registry | undefined {
  const value = (globalThis as { _probaraDebugIds?: unknown })._probaraDebugIds;
  return typeof value === 'object' && value !== null ? (value as Registry) : undefined;
}

/** The debug ID of each injected file loaded so far, by the file name its frames carry. */
function debugIdsByFile(): ReadonlyMap<string, string> {
  const registry = registryNow();
  if (registry !== resolved.registry) {
    resolved = { registry, count: 0, read: new Set(), byFile: new Map() };
  }
  if (registry === undefined) return resolved.byFile;
  const stacks = Object.keys(registry);
  if (stacks.length === resolved.count) return resolved.byFile;
  for (const stack of stacks) {
    if (resolved.read.has(stack)) continue;
    resolved.read.add(stack);
    const debugId = registry[stack];
    const file = parseStackTrace(stack).at(-1)?.filename;
    if (typeof debugId === 'string' && file !== undefined) resolved.byFile.set(file, debugId);
  }
  resolved.count = stacks.length;
  return resolved.byFile;
}

/** `event` with a source map image for each frame file that has a debug ID, once per file. */
export function withDebugImages(event: ProbaraEvent): ProbaraEvent {
  const frames = event.exception?.values.flatMap((value) => value.stacktrace?.frames ?? []) ?? [];
  if (frames.length === 0) return event;
  const byFile = debugIdsByFile();
  if (byFile.size === 0) return event;
  const images: DebugImage[] = [...(event.debug_meta?.images ?? [])];
  const known = new Set(images.map((image) => image.code_file));
  for (const { filename } of frames) {
    const debugId = filename === undefined ? undefined : byFile.get(filename);
    if (filename === undefined || debugId === undefined || known.has(filename)) continue;
    known.add(filename);
    images.push({ type: 'sourcemap', code_file: filename, debug_id: debugId });
  }
  return images.length === 0 ? event : { ...event, debug_meta: { images } };
}
