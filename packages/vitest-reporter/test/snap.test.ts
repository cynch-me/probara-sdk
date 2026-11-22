/**
 * `probaraSnap` in real Vitest browser mode, on every supported major: Playwright's Chromium, headless, captures
 * through the browser provider's own screenshot, and the reporter uploads the screenshots as one build to a fake
 * Probara that verifies every PNG. The sharded runs and the Node project run on the newest major.
 */
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { missingChromiumMessage } from './support/browser.js';
import { buildReporter } from './support/reporter-build.js';
import {
  BROWSER_VERSIONS,
  createWorkspace,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type VitestVersion,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 300_000;
const COMMIT = 'a'.repeat(40);
const HOME = 'tests/home.test.ts';
const CART = 'tests/cart.test.ts';

function configOf(vitest: VitestVersion): string {
  return vitest.name === 'Vitest 3' ? 'browser-3.config.mts' : 'browser.config.mts';
}

function snapEnv(fake: FakeProbara, extra: Record<string, string> = {}): Record<string, string> {
  return probaraEnv(fake.baseUrl, {
    PROBARA_COMMIT: COMMIT,
    PROBARA_BRANCH: 'feat/cart',
    ...extra,
  });
}

interface Screenshot {
  name: string;
  sha256: string;
  browser?: string;
  viewport?: { width: number; height: number };
  colorMode?: string;
  threshold?: number;
  test: { automationKey: string; caseDisplayIds?: string[]; file: string; retry: number };
}

function screenshotsOf(fake: FakeProbara): Screenshot[] {
  return (fake.snapBuilds()[0]?.screenshots ?? []) as unknown as Screenshot[];
}

/** A run without Chromium fails with the install command, and is never skipped. */
function requireChromium(run: CommandRun): void {
  const missing = missingChromiumMessage(run.stdout + run.stderr);
  if (missing !== undefined) throw new Error(missing);
}

describe.each(BROWSER_VERSIONS)('probaraSnap in browser mode on $name', (vitest) => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let run: CommandRun;

  beforeAll(async () => {
    await buildReporter();
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest, 'snap', { browser: true });
    run = await workspace.vitest(['run', '--config', configOf(vitest)], snapEnv(fake));
    requireChromium(run);
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('keeps the exit code of the tests and logs the build page, without the token', () => {
    expect(run.exitCode).toBe(1);
    expect(run.stdout + run.stderr).toContain(
      `[probara] Sent 7 screenshots to the Snap build #1 (4 new files): ${fake.baseUrl}/projects/SHOP/snap/builds/1`,
    );
    expect(run.stdout + run.stderr).not.toContain(TOKEN);
  });

  it('sends the PNGs the browser took as one build of the run, with the browser, the viewport and the color scheme', () => {
    expect(fake.snapBuilds()).toMatchObject([
      { commit: COMMIT, branch: 'feat/cart', jobStatus: 'progress', runUlid: fake.runs()[0]?.ulid },
    ]);
    const screenshots = screenshotsOf(fake);
    expect(screenshots.map(({ name, test }) => `${test.file} ${name}`).sort()).toEqual([
      `${CART} page`,
      `${HOME} page`,
      `${HOME} page-masked`,
      `${HOME} page-whole`,
      `${HOME} retried`,
      `${HOME} second-only`,
      `${HOME} twice`,
    ]);
    for (const screenshot of screenshots) {
      expect(screenshot).toMatchObject({
        browser: 'chromium',
        viewport: { width: 414, height: 600 },
        colorMode: 'light',
      });
    }
    expect(screenshots.find(({ name }) => name === 'page-whole')?.threshold).toBe(0.1);
    // The fake stores a file only when its bytes are a PNG that hashes to its name; equal pages are one file.
    expect(fake.snapFiles()).toHaveLength(new Set(screenshots.map(({ sha256 }) => sha256)).size);
    for (const upload of fake.requestsTo('snapUploadFile')) {
      expect(upload.body).toMatchObject({ type: 'image/png' });
    }
  });

  it('gives each screenshot the automation key and the case of its test, as the results have them', () => {
    const sent = fake.reports().flatMap((report) => report.results);
    const keys = new Set(sent.map((result) => result.automationKey));
    for (const screenshot of screenshotsOf(fake)) {
      expect(keys.has(screenshot.test.automationKey)).toBe(true);
    }
    const home = screenshotsOf(fake).find(
      ({ name, test }) => name === 'page' && test.file === HOME,
    );
    expect(home?.test).toMatchObject({
      automationKey: `${HOME} > renders the home page`,
      caseDisplayIds: ['SHOP-7'],
      retry: 0,
    });
    const cart = screenshotsOf(fake).find(({ test }) => test.file === CART);
    expect(cart?.test.automationKey).toBe(`${CART} > renders the cart`);
    expect(cart?.sha256).not.toBe(home?.sha256);
  });

  it('masks what the options name, captures the whole page on demand, and leaves the page as it was', () => {
    const sent = fake.reports().flatMap((report) => report.results);
    const home = sent.find((result) => result.automationKey === `${HOME} > renders the home page`);
    // The test itself asserts that no style and no mask stay in its document.
    expect(home?.status).toBe('passed');
    const shaOf = (name: string): string | undefined =>
      screenshotsOf(fake).find((screenshot) => screenshot.name === name)?.sha256;
    expect(shaOf('page-masked')).not.toBe(shaOf('page'));
    expect(shaOf('page-whole')).not.toBe(shaOf('page'));
    // The viewport by default, and the whole document (1400 px high) on demand: Probara reads the size of each PNG.
    const sizeOf = (name: string): { width?: number; height?: number } | undefined =>
      fake
        .requestsTo('snapUploadFile')
        .map((request) => request.body as { sha256: string; width?: number; height?: number })
        .find((upload) => upload.sha256 === shaOf(name));
    // The provider captures the frame of the test, which it may round up by a pixel.
    expect(sizeOf('page')?.width).toBe(414);
    expect([600, 601]).toContain(sizeOf('page')?.height);
    expect(sizeOf('page-whole')?.width).toBe(414);
    expect(sizeOf('page-whole')?.height).toBeGreaterThanOrEqual(1400);
    // Nothing moved between two captures of one page: the same bytes.
    expect(shaOf('second-only')).toBe(shaOf('retried'));
  });

  it('sends the screenshots of the last attempt of a retried test', () => {
    const retried = screenshotsOf(fake).filter(({ test }) =>
      test.automationKey.endsWith('takes its screenshots again when it is retried'),
    );
    expect(retried.map(({ name, test }) => [name, test.retry])).toEqual([
      ['retried', 1],
      ['second-only', 1],
    ]);
  });

  it('fails the test that uses a name twice, with the rule in its error', () => {
    const twice = fake
      .reports()
      .flatMap((report) => report.results)
      .find((result) => result.automationKey === `${HOME} > uses a name twice`);
    expect(twice?.status).toBe('failed');
    expect(twice?.notes).toContain(
      'probaraSnap(): the name "twice" is already used in this test: screenshot names must be unique within a test',
    );
  });

  it('keeps the screenshots out of the result attachments, and the failure screenshot in them', () => {
    const staged = fake.stagedFiles();
    const snapped = new Set(screenshotsOf(fake).map((screenshot) => screenshot.sha256));
    expect(staged.filter((file) => snapped.has(file.sha256))).toEqual([]);
    expect(staged.filter((file) => file.name.includes('_probara_snap'))).toEqual([]);
    expect(staged.some((file) => file.type === 'image/png')).toBe(true);
  });
});

describe('shards that write a blob, merged by one run', () => {
  const vitest = BROWSER_VERSIONS.at(-1) as VitestVersion;
  let fake: FakeProbara;
  let workspace: Workspace;
  let sentByShards: number;
  let merge: CommandRun;
  const shards: CommandRun[] = [];

  beforeAll(async () => {
    await buildReporter();
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest, 'snap', { browser: true });
    // The two ways a shard gets both reporters: its config, and the command line the sharding guide gives.
    const commands = [
      ['run', '--config', 'blob.config.mts', '--shard=1/2'],
      [
        'run',
        '--config',
        configOf(vitest),
        '--shard=2/2',
        '--reporter=blob',
        '--reporter=@probara/vitest-reporter',
      ],
    ];
    for (const command of commands) {
      const run = await workspace.vitest(command, snapEnv(fake));
      requireChromium(run);
      shards.push(run);
    }
    sentByShards = fake.requests.length;
    merge = await workspace.vitest(
      ['--merge-reports', '--config', configOf(vitest)],
      snapEnv(fake),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('sends nothing from the shards, and one build of every screenshot from the merge', () => {
    expect(sentByShards).toBe(0);
    for (const shard of shards) {
      expect(shard.stdout + shard.stderr).toContain(
        'Sharded run with the blob reporter: the results are reported by vitest --merge-reports',
      );
      expect(shard.stdout + shard.stderr).not.toContain('could not attach');
    }
    expect(merge.stdout + merge.stderr).toContain(
      '[probara] Sent 7 screenshots to the Snap build #1',
    );
    expect(fake.snapBuilds()).toHaveLength(1);
    expect(fake.requestsTo('snapCreateBuild')[0]?.body).not.toHaveProperty('shard');
    const screenshots = screenshotsOf(fake);
    expect(screenshots).toHaveLength(7);
    for (const screenshot of screenshots) {
      expect(screenshot).toMatchObject({
        browser: 'chromium',
        viewport: { width: 414, height: 600 },
      });
    }
    expect(
      screenshots
        .filter(({ test }) => test.automationKey.endsWith('when it is retried'))
        .map(({ name, test }) => [name, test.retry]),
    ).toEqual([
      ['retried', 1],
      ['second-only', 1],
    ]);
    const keys = new Set(
      fake
        .reports()
        .flatMap((report) => report.results)
        .map((r) => r.automationKey),
    );
    for (const screenshot of screenshots)
      expect(keys.has(screenshot.test.automationKey)).toBe(true);
  });
});

describe('sharded Vitest runs and a Node project with probaraSnap', () => {
  const vitest = BROWSER_VERSIONS.at(-1) as VitestVersion;
  let fake: FakeProbara;
  let nodeFake: FakeProbara;
  let workspace: Workspace;
  let nodeRun: CommandRun;

  beforeAll(async () => {
    await buildReporter();
    fake = await startFakeProbara({ token: TOKEN });
    nodeFake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest, 'snap', { browser: true });
    for (const shard of ['1/2', '2/2']) {
      const run = await workspace.vitest(
        ['run', '--config', configOf(vitest), `--shard=${shard}`],
        snapEnv(fake, { PROBARA_SNAP: 'true', PROBARA_SNAP_NONCE: 'run-42' }),
      );
      requireChromium(run);
    }
    nodeRun = await workspace.vitest(['run', '--config', 'node.config.mts'], snapEnv(nodeFake));
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await nodeFake.close();
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
    expect(screenshotsOf(fake)).toHaveLength(7);
  });

  it('captures nothing in a Node project, says so once, and sends no Snap request', () => {
    const output = nodeRun.stdout + nodeRun.stderr;
    expect(nodeRun.exitCode).toBe(0);
    expect(output.split('probaraSnap() takes screenshots in browser mode only').length - 1).toBe(1);
    expect(nodeFake.reports().flatMap((report) => report.results)).toHaveLength(1);
    expect(nodeFake.requests.filter(({ route }) => route.startsWith('snap'))).toEqual([]);
  });
});
