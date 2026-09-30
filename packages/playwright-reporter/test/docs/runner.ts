/**
 * Runs the examples of the docs: a throwaway copy of the docs project (`test/fixtures/docs/project`)
 * with the files of an example, laid out like a user's (`node_modules` holds the built reporter,
 * `@probara/core` and `@playwright/test`), and the real `playwright` and `probara` bins in it.
 *
 * - `@playwright/test` is a thin package over the real one whose `test` gives every test a stand-in
 *   `page` (`test/fixtures/docs/stand-in-page.cjs`): CI has no browser.
 * - Every command loads `@probara/test-support`'s `redirect-fetch.mjs`, so each request goes to the fake Probara of the test,
 *   whatever base URL the example names.
 */
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { docsEnvOf, runEnvOf } from '@probara/test-support/docs/env';
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
const STAND_IN_PAGE = join(FIXTURES, 'stand-in-page.cjs');
const PLAYWRIGHT_CLI = join(PLAYWRIGHT_DIR, 'cli.js');

/** The environment of a configured CI job, reporting to `fake` whatever the base URL. */
export function docsEnv(
  fake: FakeProbara,
  extra: Record<string, string | undefined> = {},
): Record<string, string> {
  return docsEnvOf({ token: TOKEN, fakeUrl: fake.baseUrl, project: 'SHOP', extra });
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

/** The docs project, the files of `project`, the built reporter and Playwright, in `dir`. */
async function layOut(dir: string, project: DocProject | undefined): Promise<void> {
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
}

/**
 * A copy of the docs project with the files of `project` (its default tests unless it has its own),
 * in a new folder of `root`.
 */
export async function createDocsWorkspace(
  project?: DocProject,
  root = tmpdir(),
): Promise<DocsWorkspace> {
  const dir = await realpath(await mkdtemp(join(root, 'probara-docs-')));
  try {
    await layOut(dir, project);
  } catch (error) {
    // A workspace that cannot be set up is nobody's to remove: remove it here.
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    dir,
    run: (command, env) => {
      const bin = command.kind === 'playwright' ? PLAYWRIGHT_CLI : CLI_BIN;
      // The line's variables, but those the fake and the redirect need (`runEnvOf`).
      return runNode([bin, ...command.args], dir, runEnvOf(command.assignments, env));
    },
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}
