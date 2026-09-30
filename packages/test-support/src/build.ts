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
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
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
 * this.
 */
const STALE_LOCK_MS = 10 * 60_000;
/** How often the owner of a lock touches its owner file while it holds the lock (its heartbeat). */
const HEARTBEAT_MS = 5_000;
/**
 * An owner file untouched this long is a leftover even when its pid runs (after a second look,
 * {@link SECOND_LOOK_MS}): that pid is another process's now (the OS reused the pid of an
 * interrupted build). A live owner touches its file every {@link HEARTBEAT_MS}, however long its
 * build takes.
 */
const STALE_OWNER_MS = 2 * 60_000;
/**
 * How long an untouched owner file whose pid runs must stay untouched before it is taken over: a
 * second look this much later. Every process wakes at once from a machine's sleep, the owner file
 * as it was before; a live owner beats within {@link HEARTBEAT_MS}, and the second look sees it.
 */
const SECOND_LOOK_MS = 2 * HEARTBEAT_MS;
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

/**
 * Writes this process's owner file into `lock`, unless it has one: exactly one writer wins. The file
 * appears whole: it is written under a name of its own, then linked as `owner` (which fails for all
 * but one), so no process ever reads an owner file being written.
 */
function claim(lock: string, token: string): boolean {
  const temporary = join(lock, `owner.${String(process.pid)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify({ pid: process.pid, since: Date.now(), token }), {
      flag: 'wx',
    });
    linkSync(temporary, join(lock, 'owner'));
    return true;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'EEXIST' || code === 'ENOENT') return false;
    throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** An owner file, as a waiter judged it: its contents and the time it was last touched. */
interface Judged {
  owner: string;
  touchedMs: number;
}

/**
 * An untouched owner file whose pid runs, as first seen: taken over once a second look agrees.
 * `seenMs` is on the monotonic clock (`performance.now()`), like the heartbeat's timer: the second
 * look waits for awake time, which neither a sleep nor a wall-clock step skips.
 */
interface Suspect extends Judged {
  seenMs: number;
}

/**
 * Whether an owner file, as read, was left by a process that is gone: `gone` when its pid runs no
 * more, or it names no pid and has not been touched for {@link STALE_OWNER_MS}; `untouched` when
 * its pid runs but it has not been touched for that long (a reused pid, or an owner just waking
 * from the machine's sleep); `undefined` while its owner holds it.
 */
function leftoverOf({ owner, touchedMs }: Judged): 'gone' | 'untouched' | undefined {
  const pid = parsedPid(owner);
  if (pid !== undefined && !isAlive(pid)) return 'gone';
  if (Date.now() - touchedMs <= STALE_OWNER_MS) return undefined;
  return pid === undefined ? 'gone' : 'untouched';
}

/**
 * Whether a waiter may take over an owner file it judged a leftover. One whose pid runs only once
 * a second look, {@link SECOND_LOOK_MS} after the first, finds it untouched: `suspect` keeps the
 * first look across the waiter's polls.
 */
function mayTakeOver(judged: Judged, suspect: { current: Suspect | undefined }): boolean {
  const leftover = leftoverOf(judged);
  if (leftover !== 'untouched') {
    suspect.current = undefined;
    return leftover === 'gone';
  }
  const first = suspect.current;
  if (first?.owner !== judged.owner || first.touchedMs !== judged.touchedMs) {
    suspect.current = { ...judged, seenMs: performance.now() };
    return false;
  }
  return performance.now() - first.seenMs >= SECOND_LOOK_MS;
}

/**
 * Takes over the lock at `lock` when a process that is gone left it: `true` when this process owns
 * it now. A lock whose owner runs is never taken over, however long its build takes (it touches
 * its owner file meanwhile, and a second look waits for its beat, see {@link mayTakeOver}); one
 * without an owner file (its owner died between creating it and writing the file) once it is old.
 *
 * Atomic when several processes find the same leftover: each renames the leftover owner file to a
 * name only it uses, and one rename wins (the others find no owner file, in a lock just touched,
 * and wait). The winner checks the file it moved is the one it judged, so it never takes a live
 * owner's file (another process took the leftover over first; it puts that file back), and claims
 * the lock with an owner file only one process can create.
 */
function takeOver(lock: string, token: string, suspect: { current: Suspect | undefined }): boolean {
  const ownerFile = join(lock, 'owner');
  let judged: string;
  let touchedMs: number;
  try {
    judged = readFileSync(ownerFile, 'utf8');
    touchedMs = statSync(ownerFile).mtimeMs;
  } catch {
    try {
      if (Date.now() - statSync(lock).mtimeMs <= STALE_LOCK_MS) return false;
    } catch {
      return false;
    }
    return claim(lock, token);
  }
  if (!mayTakeOver({ owner: judged, touchedMs }, suspect)) return false;
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

/** The pid an owner file names; `undefined` when it names none (not JSON, or no number). */
function parsedPid(owner: string): number | undefined {
  try {
    const { pid } = JSON.parse(owner) as { pid?: unknown };
    return typeof pid === 'number' ? pid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Takes the lock of the package's builds (a folder: creating one is atomic), waiting its turn; the
 * owner touches its owner file until it releases it.
 */
async function lock(pkg: PackageBuild): Promise<() => Promise<void>> {
  const path = join(stateDirOf(pkg), 'lock');
  mkdirSync(stateDirOf(pkg), { recursive: true });
  const token = randomUUID();
  const release = async (heartbeat: NodeJS.Timeout): Promise<void> => {
    clearInterval(heartbeat);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const owner = ownerOf(path);
      if (owner !== undefined) {
        // Only its own lock: never one another process holds.
        if (owner.pid === process.pid && owner.token === token) {
          rmSync(path, { recursive: true, force: true });
        }
        return;
      }
      // No owner file: a waiter judging a leftover may have set it aside, and puts it back.
      if (attempt === 1) await new Promise((done) => setTimeout(done, POLL_MS));
    }
  };
  const hold = (): (() => Promise<void>) => {
    const heartbeat = setInterval(() => {
      try {
        const now = new Date();
        utimesSync(join(path, 'owner'), now, now);
      } catch {
        // Set aside for a moment, or gone: the next beat, or none.
      }
    }, HEARTBEAT_MS);
    heartbeat.unref();
    return () => release(heartbeat);
  };
  const deadline = Date.now() + WAIT_MS;
  const suspect: { current: Suspect | undefined } = { current: undefined };
  for (;;) {
    let created = false;
    try {
      mkdirSync(path);
      created = true;
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
    }
    if (created ? claim(path, token) : takeOver(path, token, suspect)) return hold();
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
    await release();
  }
}

const PACKAGES_DIR = fileURLToPath(new URL('../../', import.meta.url));
const TSC = createRequire(import.meta.url).resolve('typescript/bin/tsc');
/** The TypeScript that compiles the packages: a new version is a new build. */
const TYPESCRIPT = createRequire(import.meta.url).resolve('typescript/package.json');
/** The TypeScript settings every package extends. */
const BASE_CONFIG = '../../tsconfig.base.json';

/**
 * Runs Node with `args` in `dir`; rejects when it fails. Asynchronous, so the lock's heartbeat goes
 * on while it builds.
 */
function node(dir: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: dir, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`node ${args.join(' ')} failed in ${dir} (${signal ?? String(code)})`));
    });
  });
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
  build: () =>
    node(join(PACKAGES_DIR, 'core'), [
      '--experimental-strip-types',
      '--no-warnings',
      'scripts/build.ts',
    ]),
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
    build: () => node(dir, [TSC, '-p', 'tsconfig.build.json']),
  };
}

/** `@probara/cli`, with its bin executable as `postbuild` leaves it. */
export const CLI_BUILD: PackageBuild = {
  ...tscBuild(join(PACKAGES_DIR, 'cli'), ['dist/cli.js']),
  build: async () => {
    const dir = join(PACKAGES_DIR, 'cli');
    await node(dir, [TSC, '-p', 'tsconfig.build.json']);
    chmodSync(join(dir, 'dist', 'cli.js'), 0o755);
  },
};
