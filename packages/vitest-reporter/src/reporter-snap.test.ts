/**
 * Probara Snap in the reporter: the screenshots `probaraSnap` handed over go out as one shard of a build at the end of
 * the run, never as result attachments, against the fake Probara.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import ProbaraVitestReporter from './reporter.js';
import type { ProbaraVitestOptions } from './options.js';
import { SNAP_CONTENT_TYPE, SNAP_IMAGE_CONTENT_TYPE, SNAP_NAME } from '@probara/core';

const ROOT = '/work/shop';
const TOKEN = 'prb_test_T0KEN_must_never_leak_42';
const COMMIT = 'a'.repeat(40);

const scratch = mkdtempSync(join(tmpdir(), 'probara-vitest-reporter-snap-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** The lines `probaraSnap(name)` leaves on an attempt, with their copies in `filesDir`. */
function snapped(filesDir: string, name: string, seed: number) {
  mkdirSync(join(filesDir, 'files'), { recursive: true });
  const copy = (content: string | Uint8Array): string => {
    const id = randomUUID();
    writeFileSync(join(filesDir, 'files', id), content);
    return id;
  };
  const line = { type: 'attachment', file: '', test: '', attempt: 0, name: SNAP_NAME };
  return [
    {
      ...line,
      contentType: SNAP_CONTENT_TYPE,
      copy: copy(
        JSON.stringify({ name, viewport: { width: 414, height: 896 }, colorMode: 'light' }),
      ),
      body: 'text',
    },
    {
      ...line,
      contentType: SNAP_IMAGE_CONTENT_TYPE,
      copy: copy(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed])),
      body: 'bytes',
    },
  ];
}

/** One file with one test of a browser project, whose attempts left `attempts` lines each. */
function moduleOf(file: string, title: string, filesDir: string, attempts: unknown[][]) {
  const module = { moduleId: `${ROOT}/tests/${file}` };
  const test = {
    id: `${file}-${title}`,
    parent: { type: 'module' },
    module,
    name: title,
    options: { mode: 'run' },
    meta: () => ({
      probara: {
        filesDir,
        attempts: attempts.map((lines, retry) => ({
          repeat: 0,
          retry,
          startedAt: 1,
          startedMs: 1,
          errorsFrom: 0,
          errors: [],
          lines,
        })),
      },
    }),
    result: () => ({ state: 'passed', errors: [] }),
    diagnostic: () => ({
      duration: 1,
      startTime: 1,
      retryCount: attempts.length - 1,
      repeatCount: 0,
    }),
    annotations: () => [],
  };
  return {
    ...module,
    project: { name: 'chromium', config: { browser: { enabled: true, name: 'chromium' } } },
    state: () => 'passed',
    errors: () => [],
    children: { allTests: () => [test][Symbol.iterator](), allSuites: () => [][Symbol.iterator]() },
  } as never;
}

describe('ProbaraVitestReporter with Snap screenshots', () => {
  let fake: FakeProbara;
  let lines: string[];
  let filesDir: string;

  beforeEach(async () => {
    fake = await startFakeProbara({ token: TOKEN });
    lines = [];
    filesDir = mkdtempSync(join(scratch, 'run-'));
  });

  afterEach(async () => {
    await fake.close();
  });

  async function run(
    modules: never[],
    {
      env = {},
      config = {},
      options = {},
    }: {
      env?: Record<string, string>;
      config?: Record<string, unknown>;
      options?: ProbaraVitestOptions;
    } = {},
  ): Promise<void> {
    const logger = {
      log: (message: string) => lines.push(message),
      warn: (message: string) => lines.push(message),
      error: (message: string) => lines.push(message),
    };
    const reporter = new ProbaraVitestReporter({
      ...options,
      env: {
        PROBARA_API_TOKEN: TOKEN,
        PROBARA_PROJECT: 'PRB',
        PROBARA_BASE_URL: fake.baseUrl,
        PROBARA_COMMIT: COMMIT,
        PROBARA_BRANCH: 'feat/cart',
        ...env,
      },
    });
    reporter.onInit({ config: { root: ROOT, ...config }, logger, projects: [] } as never);
    await reporter.onTestRunStart();
    await reporter.onTestRunEnd(modules, []);
  }

  const snapRequests = () => fake.requests.filter(({ route }) => route.startsWith('snap'));
  const snapLines = () => lines.filter((line) => /snap/i.test(line));

  it('uploads the screenshots at the end of the run as one build, each with its test and the browser, linked to the run', async () => {
    await run([
      moduleOf('cart.test.ts', 'PRB-7 renders the cart', filesDir, [
        [...snapped(filesDir, 'cart', 1), ...snapped(filesDir, 'cart-menu', 2)],
      ]),
      moduleOf('home.test.ts', 'renders', filesDir, [snapped(filesDir, 'cart', 3)]),
    ]);

    const [build] = fake.snapBuilds();
    expect(fake.snapBuilds()).toHaveLength(1);
    expect(build).toMatchObject({
      commit: COMMIT,
      branch: 'feat/cart',
      jobStatus: 'progress',
      runUlid: fake.runs()[0]?.ulid,
    });
    const sent = fake.reports().flatMap((report) => report.results);
    expect(build?.screenshots).toMatchObject([
      {
        name: 'cart',
        browser: 'chromium',
        viewport: { width: 414, height: 896 },
        colorMode: 'light',
        test: {
          automationKey: sent[0]?.automationKey,
          caseDisplayIds: ['PRB-7'],
          file: 'tests/cart.test.ts',
          retry: 0,
        },
      },
      { name: 'cart-menu', test: { automationKey: sent[0]?.automationKey } },
      { name: 'cart', test: { automationKey: sent[1]?.automationKey } },
    ]);
    expect(sent[0]?.automationKey).toBe('tests/cart.test.ts > renders the cart');
    expect(snapLines()).toEqual([
      expect.stringContaining('Sent 3 screenshots to the Snap build #1 (3 new files)'),
    ]);
  });

  it('keeps the screenshots out of the result attachments', async () => {
    await run([moduleOf('cart.test.ts', 'renders', filesDir, [snapped(filesDir, 'cart', 1)])]);

    expect(fake.snapFiles()).toHaveLength(1);
    expect(fake.stagedFiles()).toEqual([]);
  });

  it('sends the screenshots of the last attempt of a retried test, with its retry', async () => {
    await run([
      moduleOf('cart.test.ts', 'renders', filesDir, [
        [...snapped(filesDir, 'cart', 1), ...snapped(filesDir, 'first-only', 2)],
        snapped(filesDir, 'cart', 3),
      ]),
    ]);

    expect(fake.snapBuilds()[0]?.screenshots).toMatchObject([{ name: 'cart', test: { retry: 1 } }]);
    expect(fake.snapBuilds()[0]?.screenshots).toHaveLength(1);
  });

  it('sends no Snap request and logs no Snap line for a run without screenshots, sharded or not', async () => {
    await run([moduleOf('cart.test.ts', 'renders', filesDir, [[]])]);
    await run([moduleOf('cart.test.ts', 'renders', filesDir, [[]])], {
      config: { shard: { index: 2, count: 2 } },
    });

    expect(fake.reports()).toHaveLength(2);
    expect(snapRequests()).toEqual([]);
    expect(snapLines()).toEqual([]);
  });

  it('finalizes the shard of a sharded run that took no screenshot, with the snap option on', async () => {
    await run([moduleOf('cart.test.ts', 'renders', filesDir, [[]])], {
      env: { PROBARA_SNAP: 'true', PROBARA_SNAP_NONCE: 'nightly-7' },
      config: { shard: { index: 2, count: 2 } },
    });

    expect(fake.requestsTo('snapCreateBuild').map(({ body }) => body)).toMatchObject([
      { ciNonce: 'nightly-7', shard: { index: 1, total: 2 }, files: [] },
    ]);
    expect(fake.requestsTo('snapFinalizeShard').map(({ body }) => body)).toEqual([
      { screenshots: [] },
    ]);
    expect(snapLines()).toEqual([]);
  });

  it('uploads the screenshots of a shard without the snap option, and warns once that the build needs it', async () => {
    await run([moduleOf('cart.test.ts', 'renders', filesDir, [snapped(filesDir, 'cart', 1)])], {
      options: { snapNonce: 'nightly-7', snapBuildName: 'mobile' },
      config: { shard: { index: 1, count: 2 } },
    });

    expect(fake.requestsTo('snapCreateBuild').map(({ body }) => body)).toMatchObject([
      { name: 'mobile', ciNonce: 'nightly-7', shard: { index: 0, total: 2 } },
    ]);
    expect(lines.filter((line) => line.includes('snap option'))).toEqual([
      expect.stringContaining(
        'This sharded run sends Probara Snap screenshots without the snap option: set snap: true (PROBARA_SNAP=true) in every shard, or the build will not complete when a shard takes no screenshot',
      ),
    ]);
  });

  it('asks for a nonce only in a sharded run that takes part in Snap', async () => {
    await run([moduleOf('cart.test.ts', 'renders', filesDir, [[]])], {
      config: { shard: { index: 1, count: 2 } },
    });
    expect(lines.filter((line) => line.includes('nonce'))).toEqual([]);

    await run([moduleOf('cart.test.ts', 'renders', filesDir, [[]])], {
      options: { snap: true },
      config: { shard: { index: 1, count: 2 } },
    });
    expect(lines.filter((line) => line.includes('nonce'))).toEqual([
      expect.stringContaining('a sharded run needs a nonce its shards share'),
    ]);
    expect(snapRequests()).toEqual([]);
  });

  it('sends no build from a watch session, and keeps the screenshots out of its results', async () => {
    await run([moduleOf('cart.test.ts', 'renders', filesDir, [snapped(filesDir, 'cart', 1)])], {
      config: { watch: true },
    });

    expect(fake.reports().flatMap((report) => report.results)).toHaveLength(1);
    expect(fake.stagedFiles()).toEqual([]);
    expect(snapRequests()).toEqual([]);
    expect(snapLines()).toEqual([]);
  });

  it('sends nothing from a shard that writes a blob, even with the snap option: the merge run uploads', async () => {
    await run([moduleOf('cart.test.ts', 'renders', filesDir, [snapped(filesDir, 'cart', 1)])], {
      env: { PROBARA_SNAP: 'true', PROBARA_SNAP_NONCE: 'nightly-7' },
      config: { shard: { index: 1, count: 2 }, reporters: [['blob', {}]] },
    });

    expect(fake.requests).toEqual([]);
  });
});
