/**
 * Browser mode in the throwaway workspaces (V10). Each Vitest major's Playwright provider is an npm alias of this
 * repository (`vitest-3-browser`, `vitest-4-browser`, `vitest-5-browser`, V-D33). Its `vitest` imports must be the
 * workspace's own Vitest: pnpm links the importer's Vitest (5.0.2) into the 3.x and 4.x providers, and a second Vitest
 * would run beside the first. So the provider and every `@vitest/*` package of its closure are copied into the
 * workspace, the other packages of the closure are linked to their real directories, and `vite` is the one Vitest uses.
 * Packages are found by walking `node_modules` on disk, since a package's `exports` may hide its `package.json`.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';

/** The command that installs the Chromium the browser tests launch (V13 runs it in CI). */
export const CHROMIUM_INSTALL_COMMAND =
  'pnpm --filter @probara/vitest-reporter exec playwright install chromium';

/**
 * The message for a browser run whose output says Playwright has no Chromium: such a run fails with it, and is never
 * skipped. `undefined` when the output says nothing of a missing browser.
 */
export function missingChromiumMessage(output: string): string | undefined {
  if (!output.includes("Executable doesn't exist")) return undefined;
  return `Chromium for Playwright is not installed. Run: ${CHROMIUM_INSTALL_COMMAND}`;
}

/** The directory of the package `name` as seen from `from`: the nearest `node_modules` that holds it, real. */
function findPackageDir(name: string, from: string): string | undefined {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dir === parse(dir).root) return undefined;
  }
}

/** Places `name` (real directory `real`) in `nodeModules`: copied when it may import Vitest, linked otherwise. */
function place(nodeModules: string, name: string, real: string, copy: boolean): void {
  const target = join(nodeModules, name);
  mkdirSync(dirname(target), { recursive: true });
  if (lstatSync(target, { throwIfNoEntry: false }))
    rmSync(target, { recursive: true, force: true });
  if (copy) cpSync(real, target, { recursive: true, dereference: true });
  else symlinkSync(real, target, 'dir');
}

/**
 * Lays out the browser provider at `providerDir` and its dependency closure in `<workspace>/node_modules`, for the
 * Vitest install at `vitestDir` (which the workspace already links as `node_modules/vitest`). Optional peers that
 * nothing installs (`terser`, `webdriverio`) are left out, as npm leaves them out.
 */
export function installBrowserProvider(
  workspace: string,
  providerDir: string,
  vitestDir: string,
): void {
  const nodeModules = join(workspace, 'node_modules');
  const providerReal = realpathSync(providerDir);
  const seen = new Set<string>(['vitest']);
  const walk = (name: string, dir: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    place(nodeModules, name, dir, name.startsWith('@vitest/') || dir === providerReal);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const needed = {
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies,
    };
    for (const dep of Object.keys(needed)) {
      if (dep === 'vitest' || dep.startsWith('vitest-')) continue;
      const depDir = findPackageDir(dep, dir);
      if (depDir !== undefined) walk(dep, depDir);
    }
  };
  const provider = JSON.parse(readFileSync(join(providerReal, 'package.json'), 'utf8')) as {
    name: string;
  };
  walk(provider.name, providerReal);
  const vite = findPackageDir('vite', realpathSync(vitestDir));
  if (vite === undefined) throw new Error(`vite is not reachable from ${vitestDir}`);
  if (!seen.has('vite')) place(nodeModules, 'vite', vite, false);
}
