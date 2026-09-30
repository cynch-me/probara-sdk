/**
 * The built package as each kind of consumer loads it: `require()` (a CommonJS Jest config, Jest
 * itself), `import` (an ES module), and TypeScript in both module systems.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CORE_DIR, PACKAGE_DIR } from './support/workspace.js';

const require = createRequire(__filename);
const TSC = require.resolve('typescript/bin/tsc');
const NODE_TYPES = dirname(dirname(require.resolve('@types/node/package.json')));
/** `tsc` runs take seconds, many more while the tests of every package run at once. */
const TSC_TIMEOUT = 120_000;

let dir = '';

beforeAll(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'probara-jest-package-')));
  const reporterDir = join(dir, 'node_modules', '@probara', 'jest-reporter');
  await mkdir(reporterDir, { recursive: true });
  await cp(join(PACKAGE_DIR, 'package.json'), join(reporterDir, 'package.json'));
  await cp(join(PACKAGE_DIR, 'dist'), join(reporterDir, 'dist'), { recursive: true });
  await symlink(CORE_DIR, join(dir, 'node_modules', '@probara', 'core'));
});

afterAll(async () => {
  if (dir !== '') await rm(dir, { recursive: true, force: true });
});

/** Runs `source` as `name` and returns what it prints. */
async function run(name: string, source: string): Promise<string> {
  await writeFile(join(dir, name), source);
  return execFileSync(process.execPath, [name], { cwd: dir, encoding: 'utf8' }).trim();
}

const USE = `
const reporter = new Reporter({}, { enabled: false });
console.log(JSON.stringify({
  name: Reporter.name,
  hooks: ['onRunStart', 'onTestFileStart', 'onTestCaseStart', 'onTestCaseResult', 'onTestFileResult', 'onRunComplete', 'getLastError']
    .filter((hook) => typeof reporter[hook] === 'function').length,
  lastError: reporter.getLastError() ?? null,
}));`;

describe('the built @probara/jest-reporter', () => {
  it('is the reporter class for require() and for import', async () => {
    const expected = JSON.stringify({ name: 'ProbaraJestReporter', hooks: 7, lastError: null });
    expect(
      await run('require.cjs', `const Reporter = require('@probara/jest-reporter');${USE}`),
    ).toBe(expected);
    expect(await run('import.mjs', `import Reporter from '@probara/jest-reporter';${USE}`)).toBe(
      expected,
    );
  });

  it('is a class a reporter of its own can extend, overriding hooks', async () => {
    const extended = `
const Reporter = require('@probara/jest-reporter');
class Mine extends Reporter {
  onRunStart() {
    this.started = true;
    super.onRunStart();
  }
}
const mine = new Mine({}, { enabled: false });
mine.onRunStart();
console.log(JSON.stringify({
  mine: mine instanceof Mine,
  reporter: mine instanceof Reporter,
  started: mine.started === true,
  lastError: mine.getLastError() ?? null,
}));`;
    expect(JSON.parse(await run('extend.cjs', extended))).toEqual({
      mine: true,
      reporter: true,
      started: true,
      lastError: null,
    });
  });

  it('offers the probara helpers, by require() and by a named import', async () => {
    const use = `console.log([typeof probara.step, probara.title('x') === probara].join(' '));`;
    expect(
      await run('helpers.cjs', `const { probara } = require('@probara/jest-reporter');${use}`),
    ).toBe('function true');
    expect(
      await run('helpers.mjs', `import { probara } from '@probara/jest-reporter';${use}`),
    ).toBe('function true');
  });

  it('loads neither the reporter nor the reporting library for the helpers alone', async () => {
    const loaded = `
const own = () => Object.keys(require.cache);
const { probara } = require('@probara/jest-reporter');
const before = own();
new (require('@probara/jest-reporter'))({}, { enabled: false });
console.log(JSON.stringify({ before, after: own() }));`;
    const { before, after } = JSON.parse(await run('light.cjs', loaded)) as Record<
      string,
      string[]
    >;
    const heavy = (paths: string[] | undefined) =>
      (paths ?? []).filter((path) =>
        /jest-reporter\/dist\/reporter\.js$|core\/dist\/cjs\/(index|client)\.js$/.test(path),
      );
    expect(heavy(before)).toEqual([]);
    expect(before?.some((path) => path.endsWith('core/dist/cjs/metadata-entry.js'))).toBe(true);
    // Jest creating the reporter loads it.
    expect(heavy(after)).toHaveLength(3);
  });

  it('has a light setup file for setupFilesAfterEnv, silent outside Jest and without the reporter', async () => {
    const loaded = `
const before = Object.keys(require.cache);
require('@probara/jest-reporter/setup');
const after = Object.keys(require.cache).filter((path) => !before.includes(path));
console.log(JSON.stringify(after));`;
    const paths = JSON.parse(await run('setup.cjs', loaded)) as string[];
    expect(paths.some((path) => path.endsWith('jest-reporter/dist/setup.js'))).toBe(true);
    expect(
      paths.filter((path) => /jest-reporter\/dist\/(reporter|index)\.js$|core\/dist\//.test(path)),
    ).toEqual([]);
    expect(
      await run('setup.mjs', `import '@probara/jest-reporter/setup';\nconsole.log('ok');`),
    ).toBe('ok');
  });

  it(
    'types the class and its options for TypeScript, in CommonJS and in ES modules',
    { timeout: TSC_TIMEOUT },
    async () => {
      const source = `import Reporter, { type ProbaraJestOptions } from '@probara/jest-reporter';
const options: ProbaraJestOptions = { projectId: 'SHOP', keyIncludesFile: false };
const reporter: Reporter = new Reporter({}, options);
export const lastError: Error | undefined = reporter.getLastError();
`;
      const helpers = `import { probara, type ProbaraAttachment } from '@probara/jest-reporter';
const total: number = probara.step('Sum', () => 3, { expected: '3' });
export const paid: Promise<string> = probara.step('Pay', async () => 'paid');
const file: ProbaraAttachment = { name: 'log', body: 'text' };
export const done: Promise<void> = probara.id(['PRB-1']).tags('smoke').attach(file);
export { total };
`;
      const setup = `import '@probara/jest-reporter/setup';\n`;
      await writeFile(
        join(dir, 'consumer.mts'),
        setup + source + helpers.replace('import', '\nimport'),
      );
      await writeFile(
        join(dir, 'consumer.cts'),
        setup + source + helpers.replace('import', '\nimport'),
      );
      await writeFile(
        join(dir, 'wrong.mts'),
        `import Reporter, { probara } from '@probara/jest-reporter';
new Reporter({}, { keyIncludesFile: 'yes' });
probara.title(42);
`,
      );
      expect(tsc(['consumer.mts', 'consumer.cts'])).toEqual({ status: 0, output: '' });
      const wrong = tsc(['wrong.mts']);
      expect(wrong.status).not.toBe(0);
      expect(wrong.output).toMatch(/wrong\.mts.*'string' is not assignable to type 'boolean/s);
      expect(wrong.output).toMatch(/wrong\.mts\(3,.*'number' is not assignable to .*'string'/s);
    },
  );

  it(
    'types the class, its options and the helpers under "module": "commonjs" (node10 resolution)',
    { timeout: TSC_TIMEOUT },
    async () => {
      // A TypeScript Jest config (jest.config.ts) of a CommonJS project, as ts-node checks it.
      await writeFile(
        join(dir, 'jest.config.ts'),
        `import Reporter = require('@probara/jest-reporter');
import type { ProbaraJestOptions } from '@probara/jest-reporter';
const options: ProbaraJestOptions = { projectId: 'SHOP', keyIncludesFile: false };
export const reporters = ['default', ['@probara/jest-reporter', options]];
export const reporter: Reporter = new Reporter({}, options);
export const total: number = Reporter.probara.step('Sum', () => 3, { expected: '3' });
`,
      );
      await writeFile(
        join(dir, 'cart.test.ts'),
        `import '@probara/jest-reporter/setup';
import { probara } from '@probara/jest-reporter';
export const paid: Promise<string> = probara.step('Pay', async () => 'paid');
`,
      );
      await writeFile(
        join(dir, 'wrong.ts'),
        `import Reporter, { probara } from '@probara/jest-reporter';
new Reporter({}, { keyIncludesFile: 'yes' });
probara.title(42);
`,
      );
      const commonjs = ['--module', 'commonjs', '--esModuleInterop'];

      expect(tsc(['jest.config.ts', 'cart.test.ts'], commonjs)).toEqual({ status: 0, output: '' });
      const wrong = tsc(['wrong.ts'], commonjs);
      expect(wrong.output).toMatch(/wrong\.ts\(2,.*'string' is not assignable to type 'boolean/s);
      expect(wrong.output).toMatch(/wrong\.ts\(3,.*'number' is not assignable to .*'string'/s);
    },
  );
});

/** `tsc --noEmit --strict` on `files` of the consumer folder, in `module` (nodenext by default). */
function tsc(files: string[], module: string[] = ['--module', 'nodenext']) {
  // An import of a file only for its effects (the setup file) must resolve too.
  const args = ['--noEmit', '--strict', '--noUncheckedSideEffectImports', ...module];
  args.push('--types', 'node', '--typeRoots', NODE_TYPES);
  const result = spawnSync(process.execPath, [TSC, ...args, ...files], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { status: result.status, output: result.stdout + result.stderr };
}
