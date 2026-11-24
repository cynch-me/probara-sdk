/**
 * Probara Snap in a real `playwright test`: `probaraSnap` in the workers, one build per run, the
 * shards of a sharded run joined by their nonce, and the screenshots of merged blob reports,
 * against a fake Probara that verifies every uploaded PNG.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';
import {
  createWorkspace,
  PLAYWRIGHT_DIR,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 180_000;
const CONFIG = 'playwright.snap.config.js';
const COMMIT = 'a'.repeat(40);
const REPORTER = '--reporter=@probara/playwright-reporter';
const PLAYWRIGHT_VERSION = (
  JSON.parse(readFileSync(join(PLAYWRIGHT_DIR, 'package.json'), 'utf8')) as { version: string }
).version;

function sha256Of(seed: number): string {
  return createHash('sha256')
    .update(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]))
    .digest('hex');
}

function snapEnv(fake: FakeProbara, extra: Record<string, string> = {}): Record<string, string> {
  return probaraEnv(fake.baseUrl, {
    PROBARA_COMMIT: COMMIT,
    PROBARA_BRANCH: 'feat/cart',
    ...extra,
  });
}

type Screenshot = { name: string; sha256: string; test: { retry: number; captureIndex: number } };

function screenshotsOf(fake: FakeProbara, build = 0): Screenshot[] {
  return (fake.snapBuilds()[build]?.screenshots ?? []) as Screenshot[];
}

describe('playwright test with probaraSnap', () => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let run: CommandRun;

  beforeAll(async () => {
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace();
    run = await workspace.playwright(['test', '--config', CONFIG, REPORTER], snapEnv(fake));
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('keeps the exit code of the tests and logs the build page on stderr, without the token', () => {
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      `[probara] Sent 5 screenshots to the Snap build #1 (5 new files): ${fake.baseUrl}/projects/PRB/snap/${fake.snapBuilds()[0]?.ulid ?? ''}`,
    );
    expect(run.stdout + run.stderr).not.toContain(TOKEN);
  });

  it('sends the screenshots of the last attempt of every test as one build of the run', () => {
    expect(fake.snapBuilds()).toMatchObject([
      { commit: COMMIT, branch: 'feat/cart', jobStatus: 'progress', runUlid: fake.runs()[0]?.ulid },
    ]);
    expect(screenshotsOf(fake)).toEqual([
      {
        name: 'home',
        sha256: sha256Of(1),
        browser: 'chromium',
        browserVersion: '131.0',
        url: 'https://shop.test/pages',
        viewport: { width: 1280, height: 720 },
        colorMode: 'light',
        sdk: { name: '@probara/playwright-reporter', version: VERSION },
        automationLibrary: { name: '@playwright/test', version: PLAYWRIGHT_VERSION },
        test: {
          automationKey: 'pages.spec.js > pages > home',
          caseDisplayIds: ['PRB-7'],
          titlePath: ['pages', 'home'],
          file: 'pages.spec.js',
          line: 21,
          column: 3,
          retry: 0,
          retries: 1,
          captureIndex: 0,
        },
      },
      expect.objectContaining({ name: 'home-menu', sha256: sha256Of(2), threshold: 0.1 }),
      expect.objectContaining({ name: 'cart', sha256: sha256Of(11) }),
      expect.objectContaining({ name: 'twice', sha256: sha256Of(20) }),
      expect.objectContaining({ name: 'broken', sha256: sha256Of(31) }),
    ]);
    expect(screenshotsOf(fake).map((screenshot) => screenshot.test.retry)).toEqual([0, 0, 1, 1, 1]);
    expect(screenshotsOf(fake).map((screenshot) => screenshot.test.captureIndex)).toEqual([
      0, 1, 0, 0, 0,
    ]);
  });

  it('fails the test that uses a name twice, with the rule in its error', () => {
    const errors = fake
      .reports()
      .flatMap((report) => report.results)
      .filter((entry) => entry.automationKey?.endsWith('a name used twice') === true)
      .map((entry) => entry.notes ?? '');

    expect(errors).toHaveLength(2);
    for (const error of errors) {
      expect(error).toContain(
        'probaraSnap(): the name "twice" is already used in this test: screenshot names must be unique within a test',
      );
    }
  });

  it('uploads each PNG as image/png with its length, and none as a result attachment', () => {
    const uploads = fake.requestsTo('snapUploadFile').map((request) => request.body);
    expect(uploads).toHaveLength(5);
    for (const upload of uploads) {
      expect(upload).toMatchObject({ type: 'image/png', contentLength: 9, size: 9 });
    }
    const staged = fake.stagedFiles();
    const snapDigests = new Set(screenshotsOf(fake).map((screenshot) => screenshot.sha256));
    expect(staged.filter((file) => snapDigests.has(file.sha256))).toEqual([]);
    expect(staged.filter((file) => file.name.includes('_probara_snap'))).toEqual([]);
  });

  it('leaves a failure screenshot a result attachment, never a Snap screenshot', () => {
    const failure = fake.stagedFiles().filter((file) => file.sha256 === sha256Of(99));

    expect(failure.map((file) => file.type)).toEqual(['image/png', 'image/png']);
    expect(screenshotsOf(fake).some((screenshot) => screenshot.sha256 === sha256Of(99))).toBe(
      false,
    );
  });
});

describe('sharded playwright runs with probaraSnap', () => {
  let fake: FakeProbara;
  let workspace: Workspace;

  beforeAll(async () => {
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace();
    for (const shard of ['1/2', '2/2']) {
      await workspace.playwright(
        ['test', '--config', CONFIG, `--shard=${shard}`, REPORTER],
        snapEnv(fake, { PROBARA_SNAP_NONCE: 'run-42', PROBARA_SNAP: 'true' }),
      );
    }
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('sends each shard with its index from 0 and the total, into one build its last shard finalizes', () => {
    expect(
      fake.requestsTo('snapCreateBuild').map((request) => {
        const { ciNonce, shard } = request.body as { ciNonce: string; shard: unknown };
        return { ciNonce, shard };
      }),
    ).toEqual([
      { ciNonce: 'run-42', shard: { index: 0, total: 2 } },
      { ciNonce: 'run-42', shard: { index: 1, total: 2 } },
    ]);
    expect(fake.snapBuilds()).toMatchObject([{ jobStatus: 'progress', shardTotal: 2 }]);
    expect(
      screenshotsOf(fake)
        .map((screenshot) => screenshot.name)
        .sort(),
    ).toEqual(['broken', 'cart', 'home', 'home-menu', 'twice']);
  });
});

describe('merged blob reports with probaraSnap', () => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let merged: CommandRun;

  beforeAll(async () => {
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace();
    await workspace.playwright(['test', '--config', CONFIG, '--reporter=blob'], {});
    expect(await readdir(join(workspace.dir, 'blob-report'))).toHaveLength(1);
    merged = await workspace.playwright(['merge-reports', REPORTER, 'blob-report'], snapEnv(fake));
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('sends the screenshots the blob report holds as files', () => {
    expect(merged.stderr).toContain('[probara] Sent 5 screenshots to the Snap build #1');
    expect(screenshotsOf(fake).map(({ name, sha256 }) => [name, sha256])).toEqual([
      ['home', sha256Of(1)],
      ['home-menu', sha256Of(2)],
      ['cart', sha256Of(11)],
      ['twice', sha256Of(20)],
      ['broken', sha256Of(31)],
    ]);
  });
});
