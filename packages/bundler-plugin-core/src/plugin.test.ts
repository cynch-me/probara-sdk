import { readFile, stat } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuildHandler, type ProbaraBundlerPluginOptions } from './index.js';
import {
  DEBUG_ID_COMMENT,
  PROJECT,
  startFakeSourceMapApi,
  tempProject,
  TOKEN,
  type FakeSourceMapApi,
  type TempProject,
} from './testing.js';

const APP = 'function boom(){throw new Error("boom")}boom;\n//# sourceMappingURL=app.js.map\n';
const MAP = JSON.stringify({ version: 3, sources: ['../src/app.ts'], names: [], mappings: 'AAAA' });

let api: FakeSourceMapApi;
let project: TempProject;
let logs: { level: string; text: string }[];

beforeEach(async () => {
  api = await startFakeSourceMapApi();
  project = await tempProject('bundler-plugin-core');
  await project.write({
    'dist/assets/app.js': APP,
    'dist/assets/app.js.map': MAP,
    'dist/assets/plain.js': 'console.log(1);\n',
    'dist/index.html': '<!doctype html>',
  });
  vi.spyOn(process, 'cwd').mockReturnValue(project.dir);
  logs = [];
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((text: unknown) => {
      logs.push({ level, text: String(text) });
    });
  }
  vi.stubEnv('PROBARA_API_TOKEN', undefined);
  vi.stubEnv('PROBARA_PROJECT', undefined);
  vi.stubEnv('PROBARA_BASE_URL', undefined);
  vi.stubEnv('PROBARA_RELEASE', undefined);
  vi.stubEnv('PROBARA_ENABLED', undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await api.close();
  await project.remove();
});

function configured(extra: ProbaraBundlerPluginOptions = {}): ProbaraBundlerPluginOptions {
  return {
    apiToken: TOKEN,
    project: PROJECT,
    baseUrl: api.baseUrl,
    release: { name: 'shop@1.4.2' },
    ...extra,
  };
}

async function build(
  options: ProbaraBundlerPluginOptions,
  files = ['assets/app.js', 'assets/plain.js'],
) {
  const handle = createBuildHandler(options, { name: '@probara/test-plugin' });
  await handle({
    dir: project.path('dist'),
    files: files.map((file) => project.path(`dist/${file}`)),
  });
}

async function built() {
  const code = await readFile(project.path('dist/assets/app.js'), 'utf8');
  const map = JSON.parse(await readFile(project.path('dist/assets/app.js.map'), 'utf8')) as Record<
    string,
    unknown
  >;
  const scope: Record<string, unknown> = {};
  runInNewContext(code.replace('boom;', ''), scope);
  return { code, map, scope, debugId: DEBUG_ID_COMMENT.exec(code)?.[1] };
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );
const texts = (level: string) => logs.filter((log) => log.level === level).map((log) => log.text);

describe('the build handler the bundler plugins share', () => {
  it('injects a debug ID and the release into each emitted file with a map, and uploads its map under that debug ID', async () => {
    await build(configured());
    const { map, scope, debugId } = await built();
    expect(debugId).toBeDefined();
    expect(map.debug_id).toBe(debugId);
    expect(scope.PROBARA_RELEASE).toEqual({ id: 'shop@1.4.2' });
    expect(Object.values(scope._probaraDebugIds as Record<string, string>)).toEqual([debugId]);
    expect(await readFile(project.path('dist/assets/plain.js'), 'utf8')).toBe('console.log(1);\n');
    expect(api.uploads).toEqual([
      {
        debugId,
        release: 'shop@1.4.2',
        url: '~/assets/app.js',
        authorization: `Bearer ${TOKEN}`,
        map,
      },
    ]);
    expect(texts('info')).toEqual([
      '[@probara/test-plugin] Injected a debug ID into 1 file',
      '[@probara/test-plugin] Uploaded 1 source map for release shop@1.4.2',
    ]);
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
  });

  it('reads the token, the project, the URL and the release from the variables the CLI reads', async () => {
    vi.stubEnv('PROBARA_API_TOKEN', TOKEN);
    vi.stubEnv('PROBARA_PROJECT', PROJECT);
    vi.stubEnv('PROBARA_BASE_URL', api.baseUrl);
    vi.stubEnv('PROBARA_RELEASE', 'shop@2.0.0');
    await build({});
    const { scope } = await built();
    expect(scope.PROBARA_RELEASE).toEqual({ id: 'shop@2.0.0' });
    expect(api.uploads.map((upload) => upload.release)).toEqual(['shop@2.0.0']);
  });

  it('puts the URL prefix before the path of each file from the output directory', async () => {
    await build(configured({ sourcemaps: { urlPrefix: '~/static/' } }));
    expect(api.uploads.map((upload) => upload.url)).toEqual(['~/static/assets/app.js']);
  });

  it('still injects without an API token, warns, and uploads nothing', async () => {
    await build(configured({ apiToken: undefined }));
    expect((await built()).debugId).toBeDefined();
    expect(api.uploads).toEqual([]);
    expect(texts('warn')).toEqual([
      '[@probara/test-plugin] No API token: set PROBARA_API_TOKEN (or the apiToken option) to upload the source maps; none was uploaded',
    ]);
  });

  it('still injects without a project, warns, and uploads nothing', async () => {
    await build(configured({ project: undefined }));
    expect((await built()).debugId).toBeDefined();
    expect(api.uploads).toEqual([]);
    expect(texts('warn')).toEqual([
      '[@probara/test-plugin] No project: set PROBARA_PROJECT (or the project option) to upload the source maps; none was uploaded',
    ]);
  });

  it('injects no release and uploads nothing without one, and says so', async () => {
    await build(configured({ release: {} }));
    const { scope, debugId } = await built();
    expect(debugId).toBeDefined();
    expect(scope).not.toHaveProperty('PROBARA_RELEASE');
    expect(api.uploads).toEqual([]);
    expect(texts('warn')).toEqual([
      '[@probara/test-plugin] No release: set PROBARA_RELEASE (or the release.name option) to upload the source maps; none was uploaded',
    ]);
  });

  it('leaves the release out of the files with release.inject false, and still uploads for it', async () => {
    await build(configured({ release: { name: 'shop@1.4.2', inject: false } }));
    const { scope } = await built();
    expect(scope).not.toHaveProperty('PROBARA_RELEASE');
    expect(api.uploads.map((upload) => upload.release)).toEqual(['shop@1.4.2']);
  });

  it('only injects with sourcemaps.disable, without a warning', async () => {
    await build(configured({ apiToken: undefined, sourcemaps: { disable: true } }));
    expect((await built()).debugId).toBeDefined();
    expect(api.uploads).toEqual([]);
    expect(texts('warn')).toEqual([]);
  });

  it('changes nothing with disable', async () => {
    await build(configured({ disable: true }));
    expect(await readFile(project.path('dist/assets/app.js'), 'utf8')).toBe(APP);
    expect(api.uploads).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('uploads nothing when PROBARA_ENABLED turns reporting off, and says why', async () => {
    vi.stubEnv('PROBARA_ENABLED', 'false');
    await build(configured());
    expect((await built()).debugId).toBeDefined();
    expect(api.uploads).toEqual([]);
    expect(texts('info').at(-1)).toMatch(
      /^\[@probara\/test-plugin\] .*PROBARA_ENABLED.*: no source map was uploaded$/,
    );
  });

  it('fails the build when Probara refuses a map, unless an errorHandler takes the error', async () => {
    await api.close();
    api = await startFakeSourceMapApi({
      status: 422,
      body: { error: { code: 'invalid_source_map', message: 'Not a map' } },
    });
    await expect(build(configured())).rejects.toThrow(
      '[@probara/test-plugin] Could not upload dist/assets/app.js.map: Probara answered 422 invalid_source_map: Not a map',
    );

    await project.write({ 'dist/assets/app.js': APP, 'dist/assets/app.js.map': MAP });
    const errors: Error[] = [];
    await build(configured({ errorHandler: (error) => errors.push(error) }));
    expect(errors.map((error) => error.message)).toEqual([
      '[@probara/test-plugin] Could not upload dist/assets/app.js.map: Probara answered 422 invalid_source_map: Not a map',
    ]);
  });

  it('deletes the files filesToDeleteAfterUpload matches once the maps are uploaded', async () => {
    await build(configured({ sourcemaps: { filesToDeleteAfterUpload: ['dist/**/*.map'] } }));
    expect(api.uploads).toHaveLength(1);
    expect(await exists(project.path('dist/assets/app.js.map'))).toBe(false);
    expect(await exists(project.path('dist/assets/app.js'))).toBe(true);
  });

  it('deletes them even when nothing could be uploaded, so no map is deployed', async () => {
    await build(
      configured({
        apiToken: undefined,
        sourcemaps: { filesToDeleteAfterUpload: 'dist/**/*.map' },
      }),
    );
    expect(await exists(project.path('dist/assets/app.js.map'))).toBe(false);
  });
});
