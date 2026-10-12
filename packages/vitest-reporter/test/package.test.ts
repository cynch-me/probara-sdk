/**
 * The built package as a consumer loads it: `import` (an ES module, the way Vitest loads a reporter
 * named in its config), and TypeScript in the consumer's module resolution. It also holds that no
 * scratch file lands in the package's sources or tests.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildReporter } from './support/reporter-build.js';
import { CORE_DIR, installOf, PACKAGE_DIR, runNode } from './support/workspace.js';

const require = createRequire(import.meta.url);
const TSC = require.resolve('typescript/bin/tsc');
const NODE_TYPES = dirname(dirname(require.resolve('@types/node/package.json')));
/** `tsc` runs take seconds, many more while the tests of every package run at once. */
const TSC_TIMEOUT = 120_000;

let dir = '';

beforeAll(async () => {
  await buildReporter();
  dir = await realpath(await mkdtemp(join(tmpdir(), 'probara-vitest-package-')));
  const reporterDir = join(dir, 'node_modules', '@probara', 'vitest-reporter');
  await mkdir(reporterDir, { recursive: true });
  await cp(join(PACKAGE_DIR, 'package.json'), join(reporterDir, 'package.json'));
  await cp(join(PACKAGE_DIR, 'dist'), join(reporterDir, 'dist'), { recursive: true });
  await symlink(CORE_DIR, join(dir, 'node_modules', '@probara', 'core'));
  // The peer: a consumer that loads the reporter has Vitest installed.
  await symlink(installOf('vitest'), join(dir, 'node_modules', 'vitest'));
}, TSC_TIMEOUT);

afterAll(async () => {
  if (dir !== '') await rm(dir, { recursive: true, force: true });
});

/** Runs `source` as `name` in the consumer folder and returns what it prints. */
async function run(name: string, source: string): Promise<string> {
  await writeFile(join(dir, name), source);
  const result = await runNode([name], dir, {});
  expect(result.exitCode).toBe(0);
  return result.stdout.trim();
}

/** `tsc --noEmit --strict` on `files` of the consumer folder, in `module` (nodenext by default). */
function tsc(files: string[], module: string[] = ['--module', 'nodenext']) {
  // An import of a file only for its effects must resolve too.
  const args = ['--noEmit', '--strict', '--noUncheckedSideEffectImports', ...module];
  args.push('--types', 'node', '--typeRoots', NODE_TYPES);
  const result = spawnSync(process.execPath, [TSC, ...args, ...files], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('the built @probara/vitest-reporter', () => {
  it('is the reporter class, the default export, which Vitest instantiates with its options', async () => {
    const use = `
const reporter = new Reporter({ enabled: false });
console.log(JSON.stringify({
  name: Reporter.name,
  hooks: ['onInit', 'onTestRunStart', 'onTestRunEnd'].filter((hook) => typeof reporter[hook] === 'function').length,
}));`;
    expect(
      await run('reporter.mjs', `import Reporter from '@probara/vitest-reporter';${use}`),
    ).toBe(JSON.stringify({ name: 'ProbaraVitestReporter', hooks: 3 }));
  });

  it('exports its entry and its manifest, and nothing of its build', async () => {
    const version = await run(
      'manifest.mjs',
      `import manifest from '@probara/vitest-reporter/package.json' with { type: 'json' };
console.log(manifest.version);`,
    );
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    expect(
      await run(
        'internal.mjs',
        `try { await import('@probara/vitest-reporter/dist/index.js'); console.log('reachable'); }
catch (error) { console.log(error.code); }`,
      ),
    ).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
  });

  it(
    'types the class and its options for TypeScript in ES modules, and refuses a wrong option',
    { timeout: TSC_TIMEOUT },
    async () => {
      await writeFile(
        join(dir, 'consumer.mts'),
        `import Reporter, { type ProbaraVitestOptions } from '@probara/vitest-reporter';
const options: ProbaraVitestOptions = { projectId: 'SHOP', keyIncludesFile: false, runCasesOnly: true };
export const reporter: Reporter = new Reporter(options);
`,
      );
      await writeFile(
        join(dir, 'wrong.mts'),
        `import Reporter from '@probara/vitest-reporter';
new Reporter({ keyIncludesFile: 'yes' });
`,
      );
      expect(tsc(['consumer.mts'])).toEqual({ status: 0, output: '' });
      const wrong = tsc(['wrong.mts']);
      expect(wrong.status).not.toBe(0);
      expect(wrong.output).toMatch(/wrong\.mts\(2,.*'string' is not assignable to type 'boolean/s);
    },
  );
});

describe('the sources of the package', () => {
  it('hold no scratch file, in the sources nor in the tests', () => {
    // A scratch file (a probe test, a one-off run) is not part of the package: nothing may land
    // beside the sources and the tests.
    const scratch: string[] = [];
    const walk = (folder: string): void => {
      for (const name of readdirSync(folder)) {
        const path = join(folder, name);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (/^(zz|scratch|tmp|debug)/i.test(name) || /\.(scratch|tmp)\./i.test(name)) {
          scratch.push(relative(PACKAGE_DIR, path));
        }
      }
    };
    walk(join(PACKAGE_DIR, 'src'));
    walk(join(PACKAGE_DIR, 'test'));
    expect(scratch).toEqual([]);
  });
});
