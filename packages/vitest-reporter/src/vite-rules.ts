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
  /** Vite's version, from its package manifest: the arguments of its file checks depend on it (`fileRulesOf`). */
  readonly version: string;
  /** Vite's resolved configuration for `config` (the reporter reads a server's; a test resolves one). */
  readonly resolveConfig: (config: Record<string, unknown>, command: 'serve') => Promise<unknown>;
  /** Vite's file check of 5.4 and of 6 and later: `(server, file)` in 5.4, `(config, file)` from 6 on. */
  readonly isFileLoadingAllowed?: ((served: unknown, file: string) => boolean) | undefined;
  /** Vite's file check before 5.4: `(url, server)`. */
  readonly isFileServingAllowed?: ((url: string, server: unknown) => boolean) | undefined;
}

/** Whether Vite serves `file` for a browser server: the decision a browser attach follows. */
export type FileRules = (server: unknown, file: string) => boolean;

/** The file rules of one Vite, and the notice its user needs once when they are not Vite's current check. */
export interface FileRulesChoice {
  /** The check; `undefined` when this Vite exports none, and the attach then refuses every path. */
  readonly check: FileRules | undefined;
  /** One line for the user, when the check is an older one or none exists. */
  readonly notice?: string | undefined;
}

function configOf(server: unknown): unknown {
  return typeof server === 'object' && server !== null
    ? (server as { config?: unknown }).config
    : undefined;
}

/**
 * The file rules of `vite`, called the way its API takes them (V-D119; the arguments were probed on vite@5.0.0,
 * 5.4.21 and 6.4.4): Vite 6 and later check a resolved configuration; Vite 5.4 checks the server, whose `config` its
 * check reads (a configuration throws there, which the attach reads as a refusal); Vite 5.0 to 5.3 export only
 * `isFileServingAllowed(url, server)`. A Vite with none of them has no check, and the notice says so.
 */
export function fileRulesOf(vite: ViteModule): FileRulesChoice {
  const major = Number.parseInt(vite.version, 10);
  const isLoadingAllowed = vite.isFileLoadingAllowed;
  if (isLoadingAllowed !== undefined) {
    return {
      check:
        major >= 6
          ? (server, file) => isLoadingAllowed(configOf(server), file)
          : (server, file) => isLoadingAllowed(server, file),
    };
  }
  const isServingAllowed = vite.isFileServingAllowed;
  if (isServingAllowed !== undefined) {
    return {
      check: (server, file) => isServingAllowed(file, server),
      notice: `Vite ${vite.version} has no isFileLoadingAllowed (it arrived in 5.4): the browser attach follows its isFileServingAllowed`,
    };
  }
  return {
    check: undefined,
    notice: `Vite ${vite.version} exports neither isFileLoadingAllowed nor isFileServingAllowed: the browser attach refuses every path`,
  };
}

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
      version?: unknown;
    };
    if (typeof manifest.version !== 'string') return undefined;
    const entry = join(dirname(manifestPath), esmEntryOf(manifest));
    const exported = (await import(pathToFileURL(entry).href)) as Omit<ViteModule, 'version'>;
    return { ...exported, version: manifest.version };
  } catch {
    return undefined;
  }
}
