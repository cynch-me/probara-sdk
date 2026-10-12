/**
 * Vite's file-access rules for the browser attach (V-D103). Vite's `isFileLoadingAllowed` decides what its dev server
 * serves: the project's `server.fs` allow and deny lists, Vite's own defaults (`.env`, certificates, `.git`) and the real
 * path of a symlink. The reporter does not depend on `vite`: it loads the Vite that the project's Vitest runs with, found
 * from the project's own Vitest, so the decision is Vite's and the version is the user's one.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The part of Vite's module the browser attach uses. */
export interface ViteModule {
  /** Vite's resolved configuration for `config` (the reporter reads a server's; a test resolves one). */
  readonly resolveConfig: (config: Record<string, unknown>, command: 'serve') => Promise<unknown>;
  /** Whether Vite's dev server serves the absolute path `file` under the resolved `config`. */
  readonly isFileLoadingAllowed: (config: unknown, file: string) => boolean;
}

/** Whether Vite serves a file, under a resolved configuration: the decision a browser attach follows. */
export type FileLoadingCheck = ViteModule['isFileLoadingAllowed'];

/** The ESM entry of a package: its `exports` `.` (a string, or its `import` condition), else `main`. */
function esmEntryOf(manifest: { exports?: unknown; main?: unknown }): string {
  const exported = manifest.exports;
  const dot =
    typeof exported === 'object' && exported !== null && !Array.isArray(exported) && '.' in exported
      ? (exported as Record<string, unknown>)['.']
      : exported;
  if (typeof dot === 'string') return dot;
  if (typeof dot === 'object' && dot !== null) {
    const imported = (dot as Record<string, unknown>).import;
    if (typeof imported === 'string') return imported;
  }
  return typeof manifest.main === 'string' ? manifest.main : './index.js';
}

/** Vite's module per `from` (a directory of the project), kept once it was found. */
const loaded = new Map<string, Promise<ViteModule | undefined>>();

/**
 * Vite's module as the Vitest of `from` resolves it: `from` is the project's root, whose Vitest is the one that runs the
 * browser server. `undefined` when Vite cannot be found or loaded; the attach then refuses to read a path, with a reason.
 */
export function loadVite(
  from: string,
  load: (from: string) => Promise<ViteModule | undefined> = importVite,
): Promise<ViteModule | undefined> {
  let module = loaded.get(from);
  if (module === undefined) {
    // A load that found no Vite is not kept: the next attach looks again, since the install may have finished (V-D120).
    module = load(from).then((found) => {
      if (found === undefined) loaded.delete(from);
      return found;
    });
    loaded.set(from, module);
  }
  return module;
}

async function importVite(from: string): Promise<ViteModule | undefined> {
  try {
    const vitest = createRequire(join(from, 'index.js')).resolve('vitest/package.json');
    const manifestPath = createRequire(vitest).resolve('vite/package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      exports?: unknown;
      main?: unknown;
    };
    const entry = join(dirname(manifestPath), esmEntryOf(manifest));
    return (await import(pathToFileURL(entry).href)) as ViteModule;
  } catch {
    return undefined;
  }
}
