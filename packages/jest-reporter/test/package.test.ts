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

  it('types the class and its options for TypeScript, in CommonJS and in ES modules', async () => {
    const source = `import Reporter, { type ProbaraJestOptions } from '@probara/jest-reporter';
const options: ProbaraJestOptions = { projectId: 'SHOP', keyIncludesFile: false };
const reporter: Reporter = new Reporter({}, options);
export const lastError: Error | undefined = reporter.getLastError();
`;
    await writeFile(join(dir, 'consumer.mts'), source);
    await writeFile(join(dir, 'consumer.cts'), source);
    await writeFile(
      join(dir, 'wrong.mts'),
      `import Reporter from '@probara/jest-reporter';
new Reporter({}, { keyIncludesFile: 'yes' });
`,
    );
    const tsc = (files: string[]) => {
      const args = ['--noEmit', '--strict', '--module', 'nodenext', '--types', 'node'];
      const result = spawnSync(
        process.execPath,
        [TSC, ...args, '--typeRoots', NODE_TYPES, ...files],
        { cwd: dir, encoding: 'utf8' },
      );
      return { status: result.status, output: result.stdout + result.stderr };
    };

    expect(tsc(['consumer.mts', 'consumer.cts'])).toEqual({ status: 0, output: '' });
    const wrong = tsc(['wrong.mts']);
    expect(wrong.status).not.toBe(0);
    expect(wrong.output).toMatch(/wrong\.mts.*'string' is not assignable to type 'boolean/s);
  });
});
