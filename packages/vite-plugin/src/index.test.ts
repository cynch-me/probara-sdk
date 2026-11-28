import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { build as viteBuild } from 'vite';
import { probaraVitePlugin } from './index.js';
import {
  APP_SOURCES,
  emittedJavaScript,
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
  project = await tempProject('vite-plugin');
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

async function build(
  options: Parameters<typeof probaraVitePlugin>[0],
  sourcemap?: boolean | 'hidden',
) {
  await viteBuild({
    root: project.dir,
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      ...(sourcemap === undefined ? {} : { sourcemap }),
      rollupOptions: { input: project.path('src/main.js') },
    },
    plugins: [probaraVitePlugin(options)],
  });
}

describe('probaraVitePlugin', () => {
  it('injects a debug ID and the release into each emitted chunk, and uploads its map after the build', async () => {
    await build(configured(), true);
    const emitted = await emittedJavaScript(project.path('dist'));
    expect(emitted).toHaveLength(1);
    const [chunk] = emitted;
    expect(chunk?.file).toMatch(/^assets\/main-[\w-]+\.js$/);
    expect(chunk?.debugId).toBeDefined();
    expect(chunk?.mapDebugId).toBe(chunk?.debugId);
    const scope = run(chunk?.code ?? '');
    expect(scope.PROBARA_RELEASE).toEqual({ id: 'shop@1.4.2' });
    expect(Object.values(scope._probaraDebugIds as Record<string, string>)).toEqual([
      chunk?.debugId,
    ]);
    expect(api.uploads).toEqual([
      {
        debugId: chunk?.debugId,
        release: 'shop@1.4.2',
        url: `~/${chunk?.file ?? ''}`,
        authorization: `Bearer ${TOKEN}`,
        map: await mapOf(chunk?.file ?? ''),
      },
    ]);
  });

  it('turns hidden source maps on when build.sourcemap is not set, uploads them, then deletes them', async () => {
    await build(configured());
    const [chunk] = await emittedJavaScript(project.path('dist'));
    expect(chunk?.debugId).toBeDefined();
    expect(chunk?.hasMap).toBe(false);
    expect(chunk?.code).not.toContain('sourceMappingURL');
    expect(api.uploads.map((upload) => [upload.debugId, upload.map.debug_id])).toEqual([
      [chunk?.debugId, chunk?.debugId],
    ]);
  });

  it('keeps the maps the build asked for', async () => {
    await build(configured(), 'hidden');
    const [chunk] = await emittedJavaScript(project.path('dist'));
    expect(chunk?.hasMap).toBe(true);
    expect(api.uploads).toHaveLength(1);
  });

  it('only injects without an API token, with a warning, and the build still succeeds', async () => {
    await build({ ...configured(), apiToken: undefined }, true);
    const [chunk] = await emittedJavaScript(project.path('dist'));
    expect(chunk?.debugId).toBeDefined();
    expect(api.uploads).toEqual([]);
    expect(warnings).toEqual([
      '[@probara/vite-plugin] No API token: set PROBARA_API_TOKEN (or the apiToken option) to upload the source maps; none was uploaded',
    ]);
  });

  it('leaves the build alone with disable', async () => {
    await build({ ...configured(), disable: true });
    const [chunk] = await emittedJavaScript(project.path('dist'));
    expect(chunk?.debugId).toBeUndefined();
    expect(chunk?.hasMap).toBe(false);
    expect(api.uploads).toEqual([]);
  });
});
