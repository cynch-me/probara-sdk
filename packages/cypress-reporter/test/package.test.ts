/**
 * The built package as each kind of consumer loads it: `require()` (what Cypress does), `import`
 * (an ES module Cypress config), and TypeScript in both module systems — the whole point of the
 * package's `exports` and `typesVersions`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOCHA_EVENTS } from '../src/cypress.js';
import { CLIENT_NAME } from '../src/options.js';
import { VERSION } from '../src/version.js';
import { CORE_DIR, PACKAGE_DIR } from './support/workspace.js';

const require = createRequire(__filename);
const TSC = require.resolve('typescript/bin/tsc');
const NODE_TYPES = dirname(dirname(require.resolve('@types/node/package.json')));
/** `tsc` runs take seconds, many more while the tests of every package run at once. */
const TSC_TIMEOUT = 120_000;

let dir = '';

beforeAll(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'probara-cypress-package-')));
  const reporterDir = join(dir, 'node_modules', '@probara', 'cypress-reporter');
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

const MANIFEST = JSON.parse(
  execFileSync(process.execPath, ['-p', "JSON.stringify(require('./package.json'))"], {
    cwd: PACKAGE_DIR,
    encoding: 'utf8',
  }),
) as {
  name: string;
  type: string;
  main: string;
  types: string;
  files: string[];
  sideEffects: string[];
  exports: Record<string, unknown>;
  typesVersions: Record<string, Record<string, string[]>>;
  peerDependencies: Record<string, string>;
  keywords: string[];
  repository: { directory: string };
};

describe('the manifest of @probara/cypress-reporter', () => {
  it('is the package Cypress requires: CommonJS, with a main and a types of dist', () => {
    expect(MANIFEST.name).toBe('@probara/cypress-reporter');
    // Cypress loads a reporter with `require`, in the CommonJS package it is.
    expect(MANIFEST.type).toBe('commonjs');
    expect([MANIFEST.main, MANIFEST.types]).toEqual(['./dist/index.js', './dist/index.d.ts']);
  });

  it('exports the reporter, its plugin and its support file, with types for each', () => {
    expect(MANIFEST.exports).toEqual({
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './setup': { types: './dist/setup.d.ts', default: './dist/setup.js' },
      './support': { types: './dist/support.d.ts', default: './dist/support.js' },
      './package.json': './package.json',
    });
    // A TypeScript that resolves through `typesVersions` (node10, a `moduleResolution: node`).
    expect(MANIFEST.typesVersions).toEqual({
      '*': { setup: ['./dist/setup.d.ts'], support: ['./dist/support.d.ts'] },
    });
  });

  it('keeps the support entry a side effect, so a bundler never drops it', () => {
    // A support file loads the package for its effects alone (`require('@probara/cypress-reporter/
    // support')`), which a bundler drops for a package whose files it may assume are pure: with
    // `sideEffects: false` Cypress's own preprocessor would leave the helpers out of the spec.
    expect(MANIFEST.sideEffects).toEqual(['./dist/support.js']);
  });

  it('packs the build, the docs and the license, in a repository of this package', () => {
    expect(MANIFEST.files).toEqual(['dist', 'docs', 'CHANGELOG.md', 'LICENSE']);
    expect(MANIFEST.repository.directory).toBe('packages/cypress-reporter');
    expect(MANIFEST.keywords).toEqual(['probara', 'test-management', 'cypress', 'reporter', 'ci']);
  });

  it('takes Cypress as a peer, from the version that has Cypress.expose()', () => {
    // A reporter loads into whatever Cypress the project has; only its own `cypress` dev
    // dependency is pinned. The plugin hands the browser its settings through `config.expose`,
    // read with `Cypress.expose('probara')`, which Cypress 15.10.0 introduced; it bundles
    // Node.js 22.19, which has the `fetch` and `String#toWellFormed` core relies on.
    expect(MANIFEST.peerDependencies).toEqual({ cypress: '>=15.10.0' });
  });
});

describe('the built @probara/cypress-reporter', () => {
  it('is the reporter class for require() and for import', async () => {
    const use = `
const Reporter = require('@probara/cypress-reporter');
console.log(JSON.stringify({
  name: Reporter.name,
  constructor: typeof Reporter === 'function' && Reporter.length >= 1,
  hooks: typeof new Reporter().end === 'function',
}));`;
    const expected = JSON.stringify({
      name: 'ProbaraCypressReporter',
      constructor: true,
      hooks: true,
    });
    expect(await run('require.cjs', use)).toBe(expected);
    expect(
      await run(
        'import.mjs',
        `import Reporter from '@probara/cypress-reporter';\nconsole.log(Reporter.name);`,
      ),
    ).toBe('ProbaraCypressReporter');
  });

  it('is the class Cypress instantiates with a runner and the reporter options', async () => {
    const use = `
const Reporter = require('@probara/cypress-reporter');
const runner = { suite: { title: '', root: true, file: 'cypress/e2e/cart.cy.js' }, on() { return this; } };
const reporter = new Reporter(runner, { reporterOptions: { projectId: 'SHOP' } });
console.log(JSON.stringify({
  spec: reporter.spec,
  hooks: ${JSON.stringify([
    'start',
    'suite',
    'suite end',
    'test',
    'hook',
    'hook end',
    'pass',
    'fail',
    'pending',
    'test end',
    'retry',
    'end',
  ])}.filter((hook) => typeof reporter[hook] === 'function').length,
}));`;
    expect(JSON.parse(await run('runner.cjs', use))).toEqual({
      spec: 'cypress/e2e/cart.cy.js',
      hooks: 12,
    });
  });

  it('hands Cypress every hook of the reporter it loads', async () => {
    const implementation = join(
      dir,
      'node_modules',
      '@probara',
      'cypress-reporter',
      'dist',
      'reporter.js',
    );
    const compare = `
const Reporter = require('@probara/cypress-reporter');
const { ProbaraCypressReporter: Implementation } = require(${JSON.stringify(implementation)});
const events = ${JSON.stringify(MOCHA_EVENTS)};
const hooks = events.filter((name) => typeof Implementation.prototype[name] === 'function');
console.log(JSON.stringify({
  hooks: hooks.length,
  missing: hooks.filter((hook) => typeof Reporter.prototype[hook] !== 'function'),
}));`;
    // Every event hook of the reporter must reach it through the class Cypress instantiates: a
    // hook the reporter gains and the class does not forward is a hook no result ever comes from.
    const { hooks, missing } = JSON.parse(await run('hooks.cjs', compare)) as {
      hooks: number;
      missing: string[];
    };
    expect(missing).toEqual([]);
    expect(hooks).toBeGreaterThanOrEqual(12);
  });

  it('exports the plugin and the support file as their own entries', async () => {
    expect(
      await run(
        'entries.cjs',
        `const { probaraNodeEvents } = require('@probara/cypress-reporter/setup');
const support = require('@probara/cypress-reporter/support');
console.log(JSON.stringify({ plugin: typeof probaraNodeEvents, support: typeof support }));`,
      ),
    ).toBe(JSON.stringify({ plugin: 'function', support: 'object' }));
    expect(
      await run(
        'entries.mjs',
        `import { probaraNodeEvents } from '@probara/cypress-reporter/setup';\nimport '@probara/cypress-reporter/support';\nconsole.log(typeof probaraNodeEvents);`,
      ),
    ).toBe('function');
  });

  it('never throws from its constructor, whatever it is given', async () => {
    const given = ['undefined', 'null', '42', '"a string"', '{}', '{ reporterOptions: null }'];
    for (const value of given) {
      const use = `
const Reporter = require('@probara/cypress-reporter');
for (const options of [${value}]) {
  const reporter = new Reporter({ suite: { title: '', root: true, file: 'cypress/e2e/cart.cy.js' }, on() { return this; } }, options);
  if (typeof reporter.end !== 'function') throw new Error('no end hook');
}
console.log('ok');`;
      expect(await run('given.cjs', use)).toBe('ok');
    }
  });

  it('names itself and its version as the client, in the built code', () => {
    expect(CLIENT_NAME).toBe(`probara-cypress-reporter/${VERSION}`);
    expect(
      execFileSync(process.execPath, ['-p', "require('./dist/options.js').CLIENT_NAME"], {
        cwd: PACKAGE_DIR,
        encoding: 'utf8',
      }).trim(),
    ).toBe(CLIENT_NAME);
  });

  it(
    'types the class, its options and the entries for TypeScript, in CommonJS and in ES modules',
    { timeout: TSC_TIMEOUT },
    async () => {
      const source = `import Reporter, { type ProbaraCypressOptions } from '@probara/cypress-reporter';
const options: ProbaraCypressOptions = {
  projectId: 'SHOP',
  keyIncludesFile: false,
  attachVideos: true,
  browserAsParameter: false,
  runCasesOnly: true,
};
const runner = { suite: { title: '', file: 'a.cy.js' }, on() { return this; } };
// Cypress hands the reporter the reporterOptions of the config, as it passes them.
const reporter: Reporter = new Reporter(runner, { reporterOptions: options });
export const spec: string = reporter.spec;
`;
      const entries = `import { probaraNodeEvents } from '@probara/cypress-reporter/setup';
import type { CypressPluginConfig } from '@probara/cypress-reporter/setup';
const config: CypressPluginConfig = { projectRoot: '/app', isInteractive: false };
export const returned: CypressPluginConfig = probaraNodeEvents(() => undefined, config);
`;
      await writeFile(join(dir, 'consumer.mts'), entries + '\n' + source);
      await writeFile(join(dir, 'consumer.cts'), entries + '\n' + source);
      await writeFile(
        join(dir, 'wrong.mts'),
        `import Reporter, { type ProbaraCypressOptions } from '@probara/cypress-reporter';
const options: ProbaraCypressOptions = { attachVideos: 'yes' };
new Reporter({ suite: { title: '', file: 'a.cy.js' }, on() { return this; } }, { reporterOptions: options });
`,
      );
      expect(tsc(['consumer.mts', 'consumer.cts'])).toEqual({ status: 0, output: '' });
      const wrong = tsc(['wrong.mts']);
      expect(wrong.status).not.toBe(0);
      expect(wrong.output).toMatch(
        /wrong\.mts\(2,42\).*'string' is not assignable to type 'boolean \| undefined'/s,
      );
    },
  );

  it(
    'types the class under "module": "commonjs" (node10 resolution, through typesVersions)',
    { timeout: TSC_TIMEOUT },
    async () => {
      // A `cypress.config.ts` of a CommonJS project, checked the way a plain node10 TypeScript does.
      await writeFile(
        join(dir, 'cypress.config.ts'),
        `import Reporter = require('@probara/cypress-reporter');
import type { ProbaraCypressOptions } from '@probara/cypress-reporter';
import { probaraNodeEvents } from '@probara/cypress-reporter/setup';
const options: ProbaraCypressOptions = { projectId: 'SHOP', runCasesOnly: true };
export const reporter = '@probara/cypress-reporter';
export const reporterOptions = options;
export const register = probaraNodeEvents;
const runner = { suite: { title: '', file: 'a.cy.js' }, on() { return this; } };
export const instance: Reporter = new Reporter(runner, { reporterOptions: options });
`,
      );
      expect(tsc(['cypress.config.ts'], ['--module', 'commonjs', '--esModuleInterop'])).toEqual({
        status: 0,
        output: '',
      });
    },
  );
});

/** `tsc --noEmit --strict` on `files` of the consumer folder, in `module` (nodenext by default). */
function tsc(files: string[], module: string[] = ['--module', 'nodenext']) {
  // An import of a file only for its effects (the support file) must resolve too. CommonJS is
  // checked the way a `moduleResolution: node` project sees it, through `typesVersions`.
  const commonjs = module[0] === 'commonjs';
  const args = [
    '--noEmit',
    '--strict',
    '--noUncheckedSideEffectImports',
    ...module,
    ...(commonjs ? ['--moduleResolution', 'node10'] : []),
    '--types',
    'node',
    '--typeRoots',
    NODE_TYPES,
  ];
  const result = spawnSync(process.execPath, [TSC, ...args, ...files], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { status: result.status, output: result.stdout + result.stderr };
}
