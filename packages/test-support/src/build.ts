/**
 * The builds the tests of a package need before they run (`globalSetup`): the end-to-end tests of
 * the CLI and of each reporter load built packages, and CI runs `pnpm test` before `pnpm build` on
 * a fresh clone. `pnpm -r test` runs the tests of several packages at once, and several of them
 * need core and the CLI: a build rewriting `dist/` in place under another package's running tests
 * would hand them half-written modules. So a package is built only when its inputs changed since
 * its last build (never while tests run on an unchanged checkout), by one process at a time.
 *
 * Plain Node and erasable TypeScript only: processes run it with `--experimental-strip-types`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A package to build before tests. */
export interface PackageBuild {
  /** The package directory. */
  dir: string;
  /**
   * The files and folders, relative to `dir`, whose contents the build reads. Test files
   * (`*.test.ts`), which no build compiles, do not count.
   */
  inputs: readonly string[];
  /** Files the build writes, relative to `dir`: the build is stale while one is missing. */
  outputs: readonly string[];
  /** Builds the package; throws when the build fails. */
  build(): void | Promise<void>;
}

/** How long a process waits for another one's build before it gives up. */
const WAIT_MS = 10 * 60_000;
/** A lock older than this is a leftover, even if a process with its id runs. */
const STALE_LOCK_MS = 10 * 60_000;
const POLL_MS = 100;

/** Where the builds of the package keep their stamp and lock: never packed, never in `dist/`. */
function stateDirOf(pkg: PackageBuild): string {
  return join(pkg.dir, 'node_modules', '.probara-build');
}

function filesOf(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => filesOf(join(path, entry.name)));
}

/** A hash of every input's path and contents: it changes with any of them. */
function stampOf(pkg: PackageBuild): string {
  const hash = createHash('sha256');
  for (const input of pkg.inputs) {
    for (const file of filesOf(resolve(pkg.dir, input))) {
      if (file.endsWith('.test.ts')) continue;
      hash.update(relative(pkg.dir, file)).update('\0').update(readFileSync(file)).update('\0');
    }
  }
  return hash.digest('hex');
}

function isCurrent(pkg: PackageBuild, stamp: string): boolean {
  const stampFile = join(stateDirOf(pkg), 'stamp');
  if (!existsSync(stampFile) || readFileSync(stampFile, 'utf8') !== stamp) return false;
  return pkg.outputs.every((output) => existsSync(resolve(pkg.dir, output)));
}

function isAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it runs, as another user.
    return (error as { code?: unknown }).code === 'EPERM';
  }
}

/** Whether the lock at `lock` was left by a process that is gone, or long ago. */
function isLeftover(lock: string): boolean {
  try {
    const owner = JSON.parse(readFileSync(join(lock, 'owner'), 'utf8')) as {
      pid?: unknown;
      since?: unknown;
    };
    const since = typeof owner.since === 'number' ? owner.since : 0;
    return !isAlive(owner.pid) || Date.now() - since > STALE_LOCK_MS;
  } catch {
    // Its owner is still writing it, or died before: old enough, it is a leftover.
    try {
      return Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS;
    } catch {
      return false;
    }
  }
}

/** Takes the lock of the package's builds (a folder: creating one is atomic), waiting its turn. */
async function lock(pkg: PackageBuild): Promise<() => void> {
  const path = join(stateDirOf(pkg), 'lock');
  mkdirSync(stateDirOf(pkg), { recursive: true });
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      mkdirSync(path);
      writeFileSync(join(path, 'owner'), JSON.stringify({ pid: process.pid, since: Date.now() }));
      return () => {
        rmSync(path, { recursive: true, force: true });
      };
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
    }
    if (isLeftover(path)) {
      rmSync(path, { recursive: true, force: true });
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(`Gave up waiting for another build of ${pkg.dir} (lock: ${path})`);
    }
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}

/**
 * Builds `pkg` unless its outputs are there and its inputs have not changed since its last build;
 * one process at a time builds a package, and one that waited finds it built. `built` or `current`.
 * A failed build throws and leaves the package stale.
 */
export async function buildWhenStale(pkg: PackageBuild): Promise<'built' | 'current'> {
  if (isCurrent(pkg, stampOf(pkg))) return 'current';
  const release = await lock(pkg);
  try {
    // The inputs as the build reads them; another process may have built them meanwhile.
    const stamp = stampOf(pkg);
    if (isCurrent(pkg, stamp)) return 'current';
    const stampFile = join(stateDirOf(pkg), 'stamp');
    rmSync(stampFile, { force: true });
    await pkg.build();
    const temporary = `${stampFile}.${String(process.pid)}.tmp`;
    writeFileSync(temporary, stamp);
    renameSync(temporary, stampFile);
    return 'built';
  } finally {
    release();
  }
}

const PACKAGES_DIR = fileURLToPath(new URL('../../', import.meta.url));
const TSC = createRequire(import.meta.url).resolve('typescript/bin/tsc');
/** The TypeScript settings every package extends. */
const BASE_CONFIG = '../../tsconfig.base.json';

function node(dir: string, args: readonly string[]): void {
  execFileSync(process.execPath, args, { cwd: dir, stdio: 'inherit' });
}

/** `@probara/core`: its ES modules and its CommonJS build, by its own build script. */
export const CORE_BUILD: PackageBuild = {
  dir: join(PACKAGES_DIR, 'core'),
  inputs: [
    'src',
    'scripts/build.ts',
    'scripts/build-package.ts',
    'tsconfig.build.json',
    'tsconfig.cjs.json',
    'package.json',
    BASE_CONFIG,
  ],
  outputs: ['dist/index.js', 'dist/cjs/index.js', 'dist/cjs/metadata-entry.js'],
  build: () => {
    node(join(PACKAGES_DIR, 'core'), [
      '--experimental-strip-types',
      '--no-warnings',
      'scripts/build.ts',
    ]);
  },
};

/** A package built by `tsc -p tsconfig.build.json` alone, such as a reporter. */
export function tscBuild(
  dir: string,
  outputs: readonly string[] = ['dist/index.js'],
): PackageBuild {
  return {
    dir,
    inputs: ['src', 'tsconfig.build.json', 'package.json', BASE_CONFIG],
    outputs,
    build: () => {
      node(dir, [TSC, '-p', 'tsconfig.build.json']);
    },
  };
}

/** `@probara/cli`, with its bin executable as `postbuild` leaves it. */
export const CLI_BUILD: PackageBuild = {
  ...tscBuild(join(PACKAGES_DIR, 'cli'), ['dist/cli.js']),
  build: () => {
    const dir = join(PACKAGES_DIR, 'cli');
    node(dir, [TSC, '-p', 'tsconfig.build.json']);
    chmodSync(join(dir, 'dist', 'cli.js'), 0o755);
  },
};
