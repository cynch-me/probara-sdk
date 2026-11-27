import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { build as esbuild } from 'esbuild';
import { probaraEsbuildPlugin } from './index.js';
import {
  APP_SOURCES,
  emittedJavaScript,
  exists,
  PROJECT,
  startFakeSourceMapApi,
  tempProject,
  TOKEN,
  type FakeSourceMapApi,
  type TempProject,
} from '@probara/bundler-plugin-core/testing';

let api: FakeSourceMapApi;
let project: TempProject;
let warnings: string[];

beforeEach(async () => {
  api = await startFakeSourceMapApi();
  project = await tempProject('esbuild-plugin');
  await project.write(APP_SOURCES);
  vi.spyOn(process, 'cwd').mockReturnValue(project.dir);
  warnings = [];
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation((text: unknown) => {
    warnings.push(String(text));
  });
  for (const name of [
    'PROBARA_API_TOKEN',
    'PROBARA_PROJECT',
    'PROBARA_BASE_URL',
    'PROBARA_RELEASE',
    'PROBARA_ENABLED',
  ]) {
    vi.stubEnv(name, undefined);
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await api.close();
  await project.remove();
});

const configured = () => ({
  apiToken: TOKEN,
  project: PROJECT,
  baseUrl: api.baseUrl,
  release: { name: 'shop@1.4.2' },
});

async function mapOf(file: string): Promise<unknown> {
  return JSON.parse(await readFile(project.path(`dist/${file}.map`), 'utf8')) as unknown;
}

function run(code: string): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  runInNewContext(code, scope);
  return scope;
}

async function build(options: Parameters<typeof probaraEsbuildPlugin>[0], write = true) {
  return esbuild({
    absWorkingDir: project.dir,
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'iife',
    sourcemap: true,
    outdir: 'dist',
    write,
    logLevel: 'silent',
    plugins: [probaraEsbuildPlugin(options)],
  });
}

describe('probaraEsbuildPlugin', () => {
  it('injects a debug ID and the release into each emitted file, and uploads its map after the build', async () => {
    await build(configured());
    const [chunk, ...others] = await emittedJavaScript(project.path('dist'));
    expect(others).toEqual([]);
    expect(chunk?.file).toBe('main.js');
    expect(chunk?.debugId).toBeDefined();
    expect(chunk?.mapDebugId).toBe(chunk?.debugId);
    const scope = run(chunk?.code ?? '');
    expect(scope.PROBARA_RELEASE).toEqual({ id: 'shop@1.4.2' });
    expect(Object.values(scope._probaraDebugIds as Record<string, string>)).toEqual([
      chunk?.debugId,
    ]);
    expect(typeof scope.probaraTestTotal).toBe('function');
    expect(api.uploads).toEqual([
      {
        debugId: chunk?.debugId,
        release: 'shop@1.4.2',
        url: '~/main.js',
        authorization: `Bearer ${TOKEN}`,
        map: await mapOf('main.js'),
      },
    ]);
  });

  it('only injects without an API token, with a warning, and the build still succeeds', async () => {
    await build({ ...configured(), apiToken: undefined });
    const [chunk] = await emittedJavaScript(project.path('dist'));
    expect(chunk?.debugId).toBeDefined();
    expect(api.uploads).toEqual([]);
    expect(warnings).toEqual([
      '[@probara/esbuild-plugin] No API token: set PROBARA_API_TOKEN (or the apiToken option) to upload the source maps; none was uploaded',
    ]);
  });

  it('warns and does nothing when esbuild writes no file', async () => {
    const result = await build(configured(), false);
    expect(
      result.outputFiles?.map(
        (output) => output.path.endsWith('.js') || output.path.endsWith('.map'),
      ),
    ).toEqual([true, true]);
    expect(await exists(project.path('dist'))).toBe(false);
    expect(api.uploads).toEqual([]);
    expect(warnings).toEqual([
      '[@probara/esbuild-plugin] esbuild was run with write: false, so there is no file to inject or upload',
    ]);
  });
});
