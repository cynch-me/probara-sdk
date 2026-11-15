/**
 * The package's side effects as a bundler sees them: importing the script-tag build for its effect
 * keeps it, and the ES module entry still tree-shakes, so a site that imports one function does not
 * ship the recorder. The test bundles with the real tsdown into a temporary directory.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsdown';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const scratch: string[] = [];

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'probara-vis-side-effects-'));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

async function bundle(cwd: string, entry: string): Promise<string> {
  const outDir = join(cwd, 'out');
  await build({
    config: false,
    cwd,
    entry: [entry],
    format: 'esm',
    platform: 'browser',
    outDir,
    dts: false,
    logLevel: 'silent',
    external: ['@probara/vis-capture'],
    deps: { alwaysBundle: ['@probara/vis'] },
  });
  return readFileSync(join(outDir, 'entry.mjs'), 'utf8');
}

describe('the side effects of @probara/vis', () => {
  it('keeps the script-tag build when a bundler imports it for its effect', async () => {
    const cwd = scratchDir();
    // The package as installed: its real manifest, with stand-ins for the built files.
    const installed = join(cwd, 'node_modules', '@probara', 'vis');
    mkdirSync(join(installed, 'dist'), { recursive: true });
    copyFileSync(join(ROOT, 'package.json'), join(installed, 'package.json'));
    writeFileSync(join(installed, 'dist', 'index.js'), 'export const loaded = true;\n');
    writeFileSync(
      join(installed, 'dist', 'vis.iife.js'),
      'globalThis.__probaraVisScriptLoaded = true;\n',
    );
    writeFileSync(join(cwd, 'entry.js'), "import '@probara/vis/iife';\n");

    const code = await bundle(cwd, 'entry.js');

    expect(code).toContain('__probaraVisScriptLoaded = true');
  }, 60_000);

  it('drops the recorder from a bundle that imports only the metadata API', async () => {
    const cwd = scratchDir();
    const source = join(ROOT, 'src', 'index.ts').replaceAll('\\', '/');
    writeFileSync(
      join(cwd, 'entry.ts'),
      `import { metadata } from '${source}';\nmetadata(() => ({ plan: 'pro' }));\n`,
    );

    const code = await bundle(cwd, 'entry.ts');

    expect(code).toContain('answerMetadataRequests');
    expect(code).not.toContain('data-probara-vis-recorder');
    expect(code).not.toContain('getDisplayMedia');
  }, 60_000);
});
