/**
 * Runs the examples of the docs: a throwaway copy of the docs project (`test/fixtures/docs/project`)
 * with the files of an example, laid out like a user's (`node_modules` holds the built reporter and
 * `@probara/core`), and the real `jest` (the default dev dependency, Jest 30) and `probara` bins in
 * it.
 *
 * - An example that brings its own config (`jest.config.mjs`, a `jest` key in `package.json`...)
 *   replaces the default `jest.config.js`: Jest refuses a project with two.
 * - Every command loads `@probara/test-support`'s `redirect-fetch.mjs`, so each request goes to the
 *   fake Probara of the test, whatever base URL the example names.
 */
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { REDIRECT_FETCH_URL } from '@probara/test-support/docs/redirect';
import type { FakeProbara } from '@probara/test-support/fake-probara';
import {
  CLI_BIN,
  installPackages,
  JEST_VERSIONS,
  jestBinOf,
  runNode,
  TOKEN,
  type CommandRun,
} from '../support/workspace.js';
import { CONFIG_FILE, type Command, type DocProject } from './examples.js';

const DOCS_PROJECT = join(__dirname, '..', 'fixtures', 'docs', 'project');
/** Jest 30: the docs describe the current version. */
const JEST = JEST_VERSIONS[1];
const JEST_BIN = jestBinOf(JEST);
/** Variables a command line of the docs may set that its run leaves out. */
const NOT_PASSED: ReadonlySet<string> = new Set([
  'PROBARA_API_TOKEN',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NODE_USE_ENV_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'NODE_USE_SYSTEM_CA',
]);

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
    NODE_OPTIONS: `--import=${REDIRECT_FETCH_URL}`,
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

/** Whether a file of an example is a Jest config of its own. */
function isOwnConfig(path: string, content: string): boolean {
  if (/^jest\.config\.[cm]?[jt]s$/.test(path)) return true;
  if (path !== 'package.json') return false;
  try {
    const manifest = JSON.parse(content) as Record<string, unknown>;
    return manifest.jest !== undefined;
  } catch {
    return false;
  }
}

/** The docs project, the files of `project` and the packages, in `dir`. */
async function layOut(dir: string, project: DocProject | undefined): Promise<void> {
  await cp(DOCS_PROJECT, dir, { recursive: true });
  if (project?.ownTests === true) await rm(join(dir, 'tests'), { recursive: true, force: true });
  const files = [...(project?.files ?? [])];
  const ownConfig = files.some(([path, content]) => isOwnConfig(path, content));
  if (ownConfig && project?.files.has(CONFIG_FILE) !== true) await rm(join(dir, CONFIG_FILE));
  for (const [path, content] of files) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  await installPackages(dir, JEST);
}

/**
 * A copy of the docs project with the files of `project` (its default tests unless it has its own),
 * in a new folder of `root`.
 */
export async function createDocsWorkspace(
  project?: DocProject,
  root = tmpdir(),
): Promise<DocsWorkspace> {
  const dir = await realpath(await mkdtemp(join(root, 'probara-jest-docs-')));
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
      const bin = command.kind === 'jest' ? JEST_BIN : CLI_BIN;
      // The fake only accepts its own token, the redirect stays whatever the line sets, and a
      // proxy or a certificate authority of the example's network is not the fake's.
      const assigned = command.assignments.filter(([name]) => !NOT_PASSED.has(name));
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
