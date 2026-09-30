/**
 * The build a package's tests need before they run (`globalSetup`): once, whatever the number of
 * packages whose tests run at the same time (`pnpm -r test`), and never while its inputs have not
 * changed, so no test ever loads a `dist` another package is rewriting.
 */
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWhenStale, CORE_BUILD, tscBuild, type PackageBuild } from './build.js';

const BUILD_MODULE = fileURLToPath(new URL('build.ts', import.meta.url));
/** No process has this id. */
const DEAD_PID = 2 ** 22 + 7;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'probara-build-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'tsconfig.build.json'), '{}\n');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A package whose build copies `src/index.ts` into `dist/index.js` and logs each build. */
function fakePackage(): PackageBuild & { builds: () => number } {
  const log = join(dir, 'builds.log');
  return {
    dir,
    inputs: ['src', 'tsconfig.build.json'],
    outputs: ['dist/index.js'],
    build: () => {
      appendFileSync(log, 'built\n');
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(join(dir, 'dist', 'index.js'), readFileSync(join(dir, 'src', 'index.ts')));
    },
    builds: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').length - 1 : 0),
  };
}

describe('buildWhenStale', () => {
  it('builds a package never built, then not again while its inputs stay the same', async () => {
    const pkg = fakePackage();
    expect(await buildWhenStale(pkg)).toBe('built');
    expect(readFileSync(join(dir, 'dist', 'index.js'), 'utf8')).toBe('export const a = 1;\n');
    expect(await buildWhenStale(pkg)).toBe('current');
    expect(pkg.builds()).toBe(1);
  });

  it('builds again when an input changes, or an output is gone', async () => {
    const pkg = fakePackage();
    await buildWhenStale(pkg);
    writeFileSync(join(dir, 'src', 'index.ts'), 'export const a = 2;\n');
    expect(await buildWhenStale(pkg)).toBe('built');
    expect(readFileSync(join(dir, 'dist', 'index.js'), 'utf8')).toBe('export const a = 2;\n');
    writeFileSync(join(dir, 'src', 'other.ts'), 'export {};\n');
    expect(await buildWhenStale(pkg)).toBe('built');
    rmSync(join(dir, 'dist'), { recursive: true });
    expect(await buildWhenStale(pkg)).toBe('built');
    expect(pkg.builds()).toBe(4);
  });

  it('ignores the test files of its inputs, which no build compiles', async () => {
    const pkg = fakePackage();
    await buildWhenStale(pkg);
    writeFileSync(join(dir, 'src', 'index.test.ts'), 'export {};\n');
    expect(await buildWhenStale(pkg)).toBe('current');
  });

  it('builds once when several processes need it at the same time', async () => {
    const outputs = await buildInProcesses(3);

    expect(outputs.sort()).toEqual(['0 built', '0 current', '0 current']);
    expect(readFileSync(join(dir, 'builds.log'), 'utf8')).toBe('built\n');
  });

  it('builds once when several processes take over the lock a dead process left', async () => {
    writeOwner({ pid: DEAD_PID, since: Date.now() });
    const outputs = await buildInProcesses(4);

    expect(outputs.sort()).toEqual(['0 built', '0 current', '0 current', '0 current']);
    expect(readFileSync(join(dir, 'builds.log'), 'utf8')).toBe('built\n');
    // Neither the lock nor a lock set aside by a takeover is left behind.
    expect(readdirSync(stateDir()).filter((name) => name.startsWith('lock'))).toEqual([]);
  });

  it('takes over the lock of a process that died while it built', async () => {
    const pkg = fakePackage();
    writeOwner({ pid: DEAD_PID, since: Date.now() });
    expect(await buildWhenStale(pkg)).toBe('built');
    expect(existsSync(lockDir())).toBe(false);
  });

  it('waits for a live build however long it takes, and builds once its owner is gone', async () => {
    const pkg = fakePackage();
    const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)']);
    try {
      // Locked an hour ago by a process that still runs: a long build, not a leftover.
      writeOwner({ pid: owner.pid, since: Date.now() - 60 * 60_000 });
      const done = buildWhenStale(pkg);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(pkg.builds()).toBe(0);
      owner.kill();
      await new Promise((resolve) => owner.once('exit', resolve));
      expect(await done).toBe('built');
    } finally {
      owner.kill();
    }
  });

  it('takes over the lock of a live pid once its owner file stays untouched on a second look (the OS reused the pid)', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'Date', 'performance'],
    });
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)']);
    try {
      const pkg = fakePackage();
      // The pid of a build interrupted an hour ago now belongs to another process.
      writeOwner({ pid: other.pid, since: Date.now() - 60 * 60_000 });
      touchOwner(Date.now() - 60 * 60_000);
      const done = buildWhenStale(pkg);
      // A first look is not enough: a live owner may be about to beat.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(pkg.builds()).toBe(0);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(pkg.builds()).toBe(1);
      expect(await done).toBe('built');
    } finally {
      other.kill();
      vi.useRealTimers();
    }
  });

  it('times the second look on a clock a wall-clock jump does not move', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'Date', 'performance'],
    });
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)']);
    try {
      const pkg = fakePackage();
      writeOwner({ pid: other.pid, since: Date.now() - 60 * 60_000 });
      touchOwner(Date.now() - 60 * 60_000);
      const done = buildWhenStale(pkg);
      await vi.advanceTimersByTimeAsync(1_000);
      // The wall clock steps a minute forward (NTP after a wake): no awake time has passed.
      vi.setSystemTime(Date.now() + 60_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(pkg.builds()).toBe(0);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(pkg.builds()).toBe(1);
      expect(await done).toBe('built');
    } finally {
      other.kill();
      vi.useRealTimers();
    }
  });

  it('waits for a live owner whose file went untouched while the machine slept, once it beats again', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'Date', 'performance'],
    });
    const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)']);
    try {
      const pkg = fakePackage();
      // Asleep for three minutes: every process wakes with the owner file as it was before.
      writeOwner({ pid: owner.pid, since: Date.now() - 10 * 60_000 });
      touchOwner(Date.now() - 3 * 60_000);
      const done = buildWhenStale(pkg);
      await vi.advanceTimersByTimeAsync(1_000);
      // The owner's first beat after waking.
      touchOwner(Date.now());
      await vi.advanceTimersByTimeAsync(20_000);
      expect(pkg.builds()).toBe(0);
      owner.kill();
      await new Promise((resolve) => owner.once('exit', resolve));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await done).toBe('built');
    } finally {
      owner.kill();
      vi.useRealTimers();
    }
  });

  it('touches its owner file while it builds, so a long build is never taken for a leftover', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'Date'] });
    try {
      const pkg = fakePackage();
      let finish: () => void = () => undefined;
      const done = buildWhenStale({
        ...pkg,
        build: async () => {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          await pkg.build();
        },
      });
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(Date.now() - statSync(join(lockDir(), 'owner')).mtimeMs).toBeLessThan(10_000);
      finish();
      expect(await done).toBe('built');
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits on an owner file it cannot read as JSON until it is untouched for long', async () => {
    const pkg = fakePackage();
    // Empty or cut short: never a dead owner while it is fresh.
    mkdirSync(lockDir(), { recursive: true });
    writeFileSync(join(lockDir(), 'owner'), '');
    const done = buildWhenStale(pkg);
    expect(await settledWithin(done, 500)).toBe('waiting');
    expect(pkg.builds()).toBe(0);
    touchOwner(Date.now() - 60 * 60_000);
    expect(await settledWithin(done, 2_000)).toBe('built');
  });

  it('releases its lock when a waiter had set its owner file aside for a moment', async () => {
    const pkg = fakePackage();
    const owner = join(lockDir(), 'owner');
    expect(
      await buildWhenStale({
        ...pkg,
        build: async () => {
          await pkg.build();
          // A waiter judging a leftover moves the file aside, then puts it back.
          renameSync(owner, `${owner}.aside`);
          setTimeout(() => {
            if (existsSync(`${owner}.aside`)) renameSync(`${owner}.aside`, owner);
          }, 20);
        },
      }),
    ).toBe('built');
    expect(existsSync(lockDir())).toBe(false);
  });

  it('leaves the lock alone when another process holds it by the end of the build', async () => {
    const pkg = fakePackage();
    const other = JSON.stringify({ pid: process.ppid, since: Date.now(), token: 'other' });
    expect(
      await buildWhenStale({
        ...pkg,
        build: async () => {
          await pkg.build();
          writeFileSync(join(lockDir(), 'owner'), other);
        },
      }),
    ).toBe('built');
    expect(readFileSync(join(lockDir(), 'owner'), 'utf8')).toBe(other);
  });

  it('builds again when an output was rewritten after its build (by another build)', async () => {
    const pkg = fakePackage();
    await buildWhenStale(pkg);
    writeFileSync(join(dir, 'dist', 'index.js'), 'export const a = 3; // another checkout\n');
    expect(await buildWhenStale(pkg)).toBe('built');
    expect(readFileSync(join(dir, 'dist', 'index.js'), 'utf8')).toBe('export const a = 1;\n');
    // The same size, written later.
    writeFileSync(join(dir, 'dist', 'index.js'), 'export const a = 9;\n');
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(dir, 'dist', 'index.js'), later, later);
    expect(await buildWhenStale(pkg)).toBe('built');
    expect(await buildWhenStale(pkg)).toBe('current');
  });

  it('builds again when an input outside the package changes', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'probara-build-outside-'));
    try {
      writeFileSync(join(outside, 'package.json'), '{"version":"5.9.2"}\n');
      const pkg = fakePackage();
      const withOutside = { ...pkg, inputs: [...pkg.inputs, join(outside, 'package.json')] };
      await buildWhenStale(withOutside);
      writeFileSync(join(outside, 'package.json'), '{"version":"5.9.3"}\n');
      expect(await buildWhenStale(withOutside)).toBe('built');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('fails, leaving the package stale, when the build fails', async () => {
    const pkg = fakePackage();
    await expect(
      buildWhenStale({
        ...pkg,
        build: () => {
          throw new Error('tsc failed');
        },
      }),
    ).rejects.toThrow('tsc failed');
    expect(await buildWhenStale(pkg)).toBe('built');
  });
});

describe('the builds of the packages', () => {
  it("count the TypeScript that compiles them, and every script of core's build", () => {
    const typescript = createRequire(import.meta.url).resolve('typescript/package.json');
    expect(tscBuild(dir).inputs).toContain(typescript);
    expect(CORE_BUILD.inputs).toContain('scripts');
    expect(
      CORE_BUILD.inputs.some((input) => /[/\\]typescript[/\\]package\.json$/.test(input)),
    ).toBe(true);
  });
});

function stateDir(): string {
  return join(dir, 'node_modules', '.probara-build');
}

function lockDir(): string {
  return join(stateDir(), 'lock');
}

function writeOwner(owner: { pid: number | undefined; since: number }): void {
  mkdirSync(lockDir(), { recursive: true });
  writeFileSync(join(lockDir(), 'owner'), JSON.stringify(owner));
}

/** Sets the time the owner file was last touched. */
function touchOwner(time: number): void {
  const date = new Date(time);
  utimesSync(join(lockDir(), 'owner'), date, date);
}

/** What `promise` settles with within `ms`, else `waiting` (it keeps running). */
async function settledWithin<T>(promise: Promise<T>, ms: number): Promise<T | 'waiting'> {
  let timer: NodeJS.Timeout | undefined;
  const waiting = new Promise<'waiting'>((resolve) => {
    timer = setTimeout(() => {
      resolve('waiting');
    }, ms);
  });
  try {
    return await Promise.race([promise, waiting]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs `buildWhenStale` in `count` processes at once: `<exit code> <built|current>` of each. */
async function buildInProcesses(count: number): Promise<string[]> {
  const script = join(dir, 'setup.mts');
  writeFileSync(
    script,
    `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWhenStale } from ${JSON.stringify(BUILD_MODULE)};
const dir = ${JSON.stringify(dir)};
const done = await buildWhenStale({
  dir,
  inputs: ['src'],
  outputs: ['dist/index.js'],
  build: async () => {
    appendFileSync(join(dir, 'builds.log'), 'built\\n');
    await new Promise((resolve) => setTimeout(resolve, 300));
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'index.js'), '');
  },
});
console.log(done);
`,
  );
  return Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise<string>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ['--experimental-strip-types', '--no-warnings', script],
            { cwd: dir },
          );
          let stdout = '';
          child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
          child.on('error', reject);
          child.on('close', (code) => {
            resolve(`${String(code)} ${stdout.trim()}`);
          });
        }),
    ),
  );
}
