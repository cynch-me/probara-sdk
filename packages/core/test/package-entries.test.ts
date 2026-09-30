/**
 * The built package as each kind of consumer loads it: ES modules (`import`), CommonJS (`require`,
 * such as Jest's module registry, which cannot load ES modules), and the light `metadata` entry a
 * test process loads. Builds the package into a temporary `node_modules`, never into `dist/`, which
 * other packages' tests may be loading meanwhile.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPackage } from '../scripts/build-package.ts';

const MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url));

let workspace = '';
let packageDir = '';

beforeAll(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), 'probara-core-entries-')));
  packageDir = join(workspace, 'node_modules', '@probara', 'core');
  mkdirSync(packageDir, { recursive: true });
  copyFileSync(MANIFEST, join(packageDir, 'package.json'));
  buildPackage(join(packageDir, 'dist'));
}, 180_000);

afterAll(() => {
  if (workspace !== '') rmSync(workspace, { recursive: true, force: true });
});

/** Runs `source` as `name` in the workspace and parses the JSON it prints. */
function run(name: string, source: string): unknown {
  writeFileSync(join(workspace, name), source);
  const stdout = execFileSync(process.execPath, [name], { cwd: workspace, encoding: 'utf8' });
  return JSON.parse(stdout) as unknown;
}

/** What a loaded entry looks like from outside: whether it is an ES module, and its exports. */
const DESCRIBE = `
function describe(entry) {
  return {
    esModule: entry[Symbol.toStringTag] === 'Module',
    exports: Object.keys(entry).filter((name) => name !== 'default').sort()
      .map((name) => name + ':' + typeof entry[name]),
  };
}
`;

/** Uses a few exports, so both builds can be compared by what they do. */
const USE = `
function use(core) {
  const messages = [];
  const recorder = core.createMetadataRecorder((message) => messages.push(message), () => {});
  recorder.tags('smoke', 'checkout');
  const titled = core.extractTitlePathCaseIds(['login PRB-12 logs in'], ['PRB']);
  return {
    key: core.buildAutomationKey({ file: 'src/login.test.js', titlePath: titled.titlePath }),
    ids: titled.ids,
    messages,
    metadata: core.readMetadataMessages(messages).metadata.tags,
  };
}
`;

type Entry = { esModule: boolean; exports: string[] };

describe('the built @probara/core', () => {
  it('gives require() a CommonJS build with the exports of the ES module build', () => {
    const esm = run(
      'entries.mjs',
      `import * as core from '@probara/core';
import * as metadata from '@probara/core/metadata';
${DESCRIBE}${USE}
console.log(JSON.stringify({ core: describe(core), metadata: describe(metadata), use: use(core) }));`,
    ) as { core: Entry; metadata: Entry; use: unknown };
    const cjs = run(
      'entries.cjs',
      `const core = require('@probara/core');
const metadata = require('@probara/core/metadata');
${DESCRIBE}${USE}
console.log(JSON.stringify({ core: describe(core), metadata: describe(metadata), use: use(metadata) }));`,
    ) as { core: Entry; metadata: Entry; use: unknown };

    expect(esm.core.esModule).toBe(true);
    expect(cjs.core.esModule).toBe(false);
    expect(cjs.metadata.esModule).toBe(false);
    expect(cjs.core.exports).toEqual(esm.core.exports);
    expect(cjs.metadata.exports).toEqual(esm.metadata.exports);
    expect(cjs.use).toEqual(esm.use);
    expect(cjs.use).toMatchObject({ key: 'src/login.test.js > login logs in', ids: ['PRB-12'] });
  });

  it('gives a test process the metadata entry: the probara.* model, recorder, case ids and keys', () => {
    const cjs = run(
      'metadata.cjs',
      `${DESCRIBE}console.log(JSON.stringify(describe(require('@probara/core/metadata'))));`,
    ) as Entry;
    const core = run(
      'core.cjs',
      `${DESCRIBE}console.log(JSON.stringify(describe(require('@probara/core'))));`,
    ) as Entry;

    expect(cjs.exports).toEqual([
      'CASE_ANNOTATION:string',
      'applyMetadataMessage:function',
      'buildAutomationKey:function',
      'createMetadataRecorder:function',
      'emptyMetadata:function',
      'extractCaseIds:function',
      'extractTitlePathCaseIds:function',
      'parseCaseDisplayId:function',
      'parseCaseIdList:function',
      'readMetadataMessages:function',
    ]);
    // The same functions as the main entry.
    expect(core.exports).toEqual(expect.arrayContaining(cjs.exports));
  });

  it('loads nothing that reports, reads the configuration or reaches the network for the metadata entry', () => {
    const loaded = run(
      'footprint.cjs',
      `require('@probara/core/metadata');
const path = require('node:path');
const dir = path.dirname(require.resolve('@probara/core/metadata'));
console.log(JSON.stringify(Object.keys(require.cache).map((file) => path.relative(dir, file))));`,
    ) as string[];

    expect(loaded.length).toBeGreaterThan(0);
    for (const heavy of ['client.js', 'config.js', 'reporter.js', 'results-file.js', 'index.js']) {
      expect(loaded).not.toContain(heavy);
    }
  });

  it('ships the declarations every condition of the exports map names', () => {
    const { exports } = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const targets: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') targets.push(value);
      else if (typeof value === 'object' && value !== null) Object.values(value).forEach(collect);
    };
    collect(exports);

    expect(targets).toEqual(
      expect.arrayContaining(['./dist/cjs/index.d.ts', './dist/metadata-entry.d.ts']),
    );
    for (const target of targets) expect(existsSync(join(packageDir, target)), target).toBe(true);
  });
});
