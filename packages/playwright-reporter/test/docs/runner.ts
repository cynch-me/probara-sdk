/**
 * Runs the examples of the docs: a throwaway copy of the docs project (`test/fixtures/docs/project`)
 * with the files of an example, laid out like a user's (`node_modules` holds the built reporter,
 * `@probara/core` and `@playwright/test`), and the real `playwright` and `probara` bins in it.
 *
 * - `@playwright/test` is a thin package over the real one whose `test` gives every test a stand-in
 *   `page` (`test/fixtures/docs/stand-in-page.cjs`): CI has no browser.
 * - Every command loads `redirect-fetch.mjs`, so each request goes to the fake Probara of the test,
 *   whatever base URL the example names.
 */
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { FakeProbara } from '@probara/test-support/fake-probara';
import {
  CLI_BIN,
  CORE_DIR,
  PACKAGE_DIR,
  PLAYWRIGHT_DIR,
  runNode,
  TOKEN,
  type CommandRun,
} from '../support/workspace.js';
import type { Command, DocProject } from './examples.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/docs/', import.meta.url));
const DOCS_PROJECT = join(FIXTURES, 'project');
const REDIRECT = pathToFileURL(join(FIXTURES, 'redirect-fetch.mjs')).href;
const STAND_IN_PAGE = join(FIXTURES, 'stand-in-page.cjs');
const PLAYWRIGHT_CLI = join(PLAYWRIGHT_DIR, 'cli.js');

/** The environment of a configured CI job, reporting to `fake` whatever the base URL. */
export function docsEnv(
  fake: FakeProbara,
  extra: Record<string, string | undefined> = {},
): Record<string, string> {
  const env: Record<string, string | undefined> = {
    PROBARA_API_TOKEN: TOKEN,
    PROBARA_PROJECT: 'SHOP',
    ...extra,
    PROBARA_DOCS_FAKE_URL: fake.baseUrl,
    NODE_OPTIONS: `--import=${REDIRECT}`,
  };
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export interface DocsWorkspace {
  readonly dir: string;
  run(command: Command, env: Record<string, string>): Promise<CommandRun>;
  remove(): Promise<void>;
}

/** `@playwright/test` over the real one, with the stand-in `page`. */
async function writePlaywright(dir: string): Promise<void> {
  const target = join(dir, 'node_modules', '@playwright', 'test');
  await mkdir(target, { recursive: true });
  const real = JSON.parse(await readFile(join(PLAYWRIGHT_DIR, 'package.json'), 'utf8')) as {
    version: string;
  };
  const manifest = {
    name: '@playwright/test',
    version: real.version,
    exports: {
      '.': { import: './index.mjs', require: './index.js', default: './index.js' },
      './package.json': './package.json',
      './reporter': './reporter.js',
    },
  };
  await writeFile(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    join(target, 'index.js'),
    [
      "'use strict';",
      `const real = require(${JSON.stringify(join(PLAYWRIGHT_DIR, 'index.js'))});`,
      `const { standInPage } = require(${JSON.stringify(STAND_IN_PAGE)});`,
      'const test = real.test.extend({ page: async ({}, use) => { await use(standInPage()); } });',
      'module.exports = { ...real, test, default: test };',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(target, 'index.mjs'),
    [
      "import { createRequire } from 'node:module';",
      'const require = createRequire(import.meta.url);',
      "const { test } = require('./index.js');",
      `export * from ${JSON.stringify(pathToFileURL(join(PLAYWRIGHT_DIR, 'index.mjs')).href)};`,
      'export { test };',
      'export default test;',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(target, 'reporter.js'),
    `module.exports = require(${JSON.stringify(join(PLAYWRIGHT_DIR, 'reporter.js'))});\n`,
  );
}

/** A copy of the docs project with the files of `project` (its default tests unless it has its own). */
export async function createDocsWorkspace(project?: DocProject): Promise<DocsWorkspace> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'probara-docs-')));
  await cp(DOCS_PROJECT, dir, { recursive: true });
  if (project?.ownTests === true) await rm(join(dir, 'tests'), { recursive: true, force: true });
  for (const [path, content] of project?.files ?? []) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  const reporterDir = join(dir, 'node_modules', '@probara', 'playwright-reporter');
  await mkdir(reporterDir, { recursive: true });
  await cp(join(PACKAGE_DIR, 'package.json'), join(reporterDir, 'package.json'));
  await cp(join(PACKAGE_DIR, 'dist'), join(reporterDir, 'dist'), { recursive: true });
  await symlink(CORE_DIR, join(dir, 'node_modules', '@probara', 'core'));
  await writePlaywright(dir);
  return {
    dir,
    run: (command, env) => {
      const bin = command.kind === 'playwright' ? PLAYWRIGHT_CLI : CLI_BIN;
      // The fake only accepts its own token, and the redirect stays whatever the line sets.
      const assigned = command.assignments.filter(([name]) => name !== 'PROBARA_API_TOKEN');
      return runNode([bin, ...command.args], dir, {
        ...env,
        ...Object.fromEntries(assigned),
        ...(env.NODE_OPTIONS === undefined ? {} : { NODE_OPTIONS: env.NODE_OPTIONS }),
        ...(env.PROBARA_DOCS_FAKE_URL === undefined
          ? {}
          : { PROBARA_DOCS_FAKE_URL: env.PROBARA_DOCS_FAKE_URL }),
      });
    },
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}
