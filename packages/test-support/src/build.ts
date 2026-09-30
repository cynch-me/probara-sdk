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
import { createHash, randomUUID } from 'node:crypto';
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
  /**
   * Files the build writes, relative to `dir`: the build is stale while one is missing, or once one
   * was rewritten after it (by `pnpm build`, or on another branch).
   */
  outputs: readonly string[];
  /** Builds the package; throws when the build fails. */
  build(): void | Promise<void>;
}

/** How long a process waits for another one's build before it gives up. */
const WAIT_MS = 10 * 60_000;
/**
 * A lock whose owner never wrote its owner file (it died in between) is a leftover once older than
 * this. A lock whose owner runs is never one, however long its build takes.
 */
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
function inputsHashOf(pkg: PackageBuild): string {
  const hash = createHash('sha256');
  for (const input of pkg.inputs) {
    for (const file of filesOf(resolve(pkg.dir, input))) {
      if (file.endsWith('.test.ts')) continue;
      hash.update(relative(pkg.dir, file)).update('\0').update(readFileSync(file)).update('\0');
    }
  }
  return hash.digest('hex');
}

/** The size and time of each output as the last build left it; `undefined` while one is missing. */
function outputsOf(pkg: PackageBuild): string | undefined {
  const outputs: string[] = [];
  for (const output of pkg.outputs) {
    const path = resolve(pkg.dir, output);
    if (!existsSync(path)) return undefined;
    const stat = statSync(path);
    outputs.push(`${output} ${String(stat.size)} ${String(stat.mtimeMs)}`);
  }
  return outputs.join('\n');
}

function isCurrent(pkg: PackageBuild, inputs: string): boolean {
  const stampFile = join(stateDirOf(pkg), 'stamp');
  if (!existsSync(stampFile)) return false;
  const outputs = outputsOf(pkg);
  return outputs !== undefined && readFileSync(stampFile, 'utf8') === `${inputs}\n${outputs}`;
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

function ownerOf(lock: string): { pid?: unknown; token?: unknown } | undefined {
  try {
    const owner: unknown = JSON.parse(readFileSync(join(lock, 'owner'), 'utf8'));
    return typeof owner === 'object' && owner !== null ? owner : {};
  } catch {
    return undefined;
  }
}

/** Writes this process's owner file into `lock`, unless it has one: exactly one writer wins. */
function claim(lock: string, token: string): boolean {
  try {
    writeFileSync(
      join(lock, 'owner'),
      JSON.stringify({ pid: process.pid, since: Date.now(), token }),
      {
        flag: 'wx',
      },
    );
    return true;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'EEXIST' || code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Takes over the lock at `lock` when a process that is gone left it: `true` when this process owns
 * it now. A lock whose owner runs is never taken over, however long its build takes; one without
 * an owner file (its owner died between creating it and writing the file) once it is old.
 *
 * Atomic when several processes find the same leftover: each renames the leftover owner file to a
 * name only it uses, and one rename wins (the others find no owner file, in a lock just touched,
 * and wait). The winner checks the file it moved is the one it judged, so it never takes a live
 * owner's file (another process took the leftover over first; it puts that file back), and claims
 * the lock with an owner file only one process can create.
 */
function takeOver(lock: string, token: string): boolean {
  const ownerFile = join(lock, 'owner');
  let judged: string;
  try {
    judged = readFileSync(ownerFile, 'utf8');
  } catch {
    try {
      if (Date.now() - statSync(lock).mtimeMs <= STALE_LOCK_MS) return false;
    } catch {
      return false;
    }
    return claim(lock, token);
  }
  if (isAlive(parsedPid(judged))) return false;
  const aside = `${ownerFile}.leftover.${String(process.pid)}.${randomUUID()}`;
  try {
    renameSync(ownerFile, aside);
  } catch {
    return false;
  }
  let moved: string | undefined;
  try {
    moved = readFileSync(aside, 'utf8');
  } catch {
    moved = undefined;
  }
  if (moved !== judged) {
    // No other process writes an owner file while the lock has none: it goes back as it was.
    renameSync(aside, ownerFile);
    return false;
  }
  rmSync(aside, { force: true });
  return claim(lock, token);
}

function parsedPid(owner: string): unknown {
  try {
    return (JSON.parse(owner) as { pid?: unknown }).pid;
  } catch {
    return undefined;
  }
}

/** Takes the lock of the package's builds (a folder: creating one is atomic), waiting its turn. */
async function lock(pkg: PackageBuild): Promise<() => void> {
  const path = join(stateDirOf(pkg), 'lock');
  mkdirSync(stateDirOf(pkg), { recursive: true });
  const token = randomUUID();
  const release = (): void => {
    // Only its own lock: never one another process holds.
    const owner = ownerOf(path);
    if (owner?.pid === process.pid && owner.token === token) {
      rmSync(path, { recursive: true, force: true });
    }
  };
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    let created = false;
    try {
      mkdirSync(path);
      created = true;
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
    }
    if (created ? claim(path, token) : takeOver(path, token)) return release;
    if (Date.now() > deadline) {
      throw new Error(`Gave up waiting for another build of ${pkg.dir} (lock: ${path})`);
    }
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}

/**
 * Builds `pkg` unless its outputs are the ones its last build wrote and its inputs have not changed
 * since; one process at a time builds a package, and one that waited finds it built. `built` or
 * `current`. A failed build throws and leaves the package stale.
 */
export async function buildWhenStale(pkg: PackageBuild): Promise<'built' | 'current'> {
  if (isCurrent(pkg, inputsHashOf(pkg))) return 'current';
  const release = await lock(pkg);
  try {
    // The inputs as the build reads them; another process may have built them meanwhile.
    const inputs = inputsHashOf(pkg);
    if (isCurrent(pkg, inputs)) return 'current';
    const stampFile = join(stateDirOf(pkg), 'stamp');
    rmSync(stampFile, { force: true });
    await pkg.build();
    const outputs = outputsOf(pkg);
    if (outputs === undefined) return 'built';
    const temporary = `${stampFile}.${String(process.pid)}.tmp`;
    writeFileSync(temporary, `${inputs}\n${outputs}`);
    renameSync(temporary, stampFile);
    return 'built';
  } finally {
    release();
  }
}

const PACKAGES_DIR = fileURLToPath(new URL('../../', import.meta.url));
const TSC = createRequire(import.meta.url).resolve('typescript/bin/tsc');
/** The TypeScript that compiles the packages: a new version is a new build. */
const TYPESCRIPT = createRequire(import.meta.url).resolve('typescript/package.json');
/** The TypeScript settings every package extends. */
const BASE_CONFIG = '../../tsconfig.base.json';

function node(dir: string, args: readonly string[]): void {
  execFileSync(process.execPath, args, { cwd: dir, stdio: 'inherit' });
}

/**
 * `@probara/core`: its ES modules and its CommonJS build, by its own build script
 * (`packages/core/scripts/build.ts`). Its inputs and outputs follow that script: what it reads and
 * what it writes.
 */
export const CORE_BUILD: PackageBuild = {
  dir: join(PACKAGES_DIR, 'core'),
  inputs: [
    'src',
    // Every script: the build script, and anything it may come to import.
    'scripts',
    'tsconfig.build.json',
    'tsconfig.cjs.json',
    'package.json',
    BASE_CONFIG,
    createRequire(join(PACKAGES_DIR, 'core', 'package.json')).resolve('typescript/package.json'),
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
    inputs: ['src', 'tsconfig.build.json', 'package.json', BASE_CONFIG, TYPESCRIPT],
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
