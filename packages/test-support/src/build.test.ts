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
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildWhenStale, type PackageBuild } from './build.js';

const BUILD_MODULE = fileURLToPath(new URL('build.ts', import.meta.url));

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
    const outputs = await Promise.all(
      [1, 2, 3].map(
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

    expect(outputs.sort()).toEqual(['0 built', '0 current', '0 current']);
    expect(readFileSync(join(dir, 'builds.log'), 'utf8')).toBe('built\n');
  });

  it('takes over the lock of a process that died while it built', async () => {
    const pkg = fakePackage();
    const lock = join(dir, 'node_modules', '.probara-build', 'lock');
    mkdirSync(lock, { recursive: true });
    // No process has this id: the lock is a leftover.
    writeFileSync(join(lock, 'owner'), JSON.stringify({ pid: 2 ** 22 + 7, since: Date.now() }));
    expect(await buildWhenStale(pkg)).toBe('built');
    expect(existsSync(lock)).toBe(false);
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
