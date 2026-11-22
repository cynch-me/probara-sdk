/** Probara Snap in the reporter: the screenshots of `probaraSnap` go out as one shard at the end. */
import type { Page, TestInfo } from '@playwright/test';
import type { FullConfig } from '@playwright/test/reporter';
import type { Logger } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeConfig, fakeResult, fakeTest } from '../test/support/playwright-fakes.js';
import ProbaraPlaywrightReporter, { type ProbaraPlaywrightOptions } from './index.js';
import { createProbaraSnap } from './snap.js';

const TOKEN = 'prb_test_T0KEN_must_never_leak_42';
const COMMIT = 'a'.repeat(40);

type Attachment = TestInfo['attachments'][number];

function png(seed: number): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
}

/** The attachments `probaraSnap(page, name)` leaves on an attempt whose page renders `seed`. */
async function snapped(...shots: [name: string, seed: number][]): Promise<Attachment[]> {
  const info = { attachments: [] as Attachment[] };
  const snap = createProbaraSnap(() => info as unknown as TestInfo);
  for (const [name, seed] of shots) {
    const page = {
      evaluate: () => Promise.resolve(false),
      addStyleTag: () => Promise.resolve({ evaluate: () => Promise.resolve() }),
      locator: (selector: string) => ({ selector }),
      screenshot: () => Promise.resolve(png(seed)),
      viewportSize: () => ({ width: 1280, height: 720 }),
      context: () => ({ browser: () => ({ browserType: () => ({ name: () => 'chromium' }) }) }),
    };
    await snap(page as unknown as Page, name);
  }
  return info.attachments;
}

describe('ProbaraPlaywrightReporter with Snap screenshots', () => {
  let fake: FakeProbara;
  let lines: string[];
  let logger: Logger;

  beforeEach(async () => {
    fake = await startFakeProbara({ token: TOKEN });
    lines = [];
    logger = {
      debug: () => undefined,
      info: (message) => lines.push(`info: ${message}`),
      warn: (message) => lines.push(`warn: ${message}`),
      error: (message) => lines.push(`error: ${message}`),
    };
  });

  afterEach(async () => {
    await fake.close();
  });

  function reporterOf(
    env: Record<string, string> = {},
    config: Partial<FullConfig> = {},
    options: ProbaraPlaywrightOptions = {},
  ) {
    const reporter = new ProbaraPlaywrightReporter({
      ...options,
      env: {
        PROBARA_API_TOKEN: TOKEN,
        PROBARA_PROJECT: 'PRB',
        PROBARA_BASE_URL: fake.baseUrl,
        PROBARA_COMMIT: COMMIT,
        PROBARA_BRANCH: 'feat/cart',
        ...env,
      },
      logger,
    });
    reporter.onBegin(fakeConfig(config));
    return reporter;
  }

  it('uploads every screenshot at the end of the run as one build, linked to its test and to the run', async () => {
    const reporter = reporterOf();
    reporter.onTestEnd(
      fakeTest({ file: 'home.spec.ts', titles: ['home', 'PRB-7 renders'] }),
      fakeResult({ attachments: await snapped(['home', 1], ['home-menu', 2]) }),
    );
    reporter.onTestEnd(
      fakeTest({ file: 'cart.spec.ts', titles: ['cart', 'renders'], project: '' }),
      fakeResult({ attachments: await snapped(['cart', 3]) }),
    );
    expect(fake.requestsTo('snapCreateBuild')).toEqual([]);

    await reporter.onEnd();

    const [run] = fake.runs();
    const [build] = fake.snapBuilds();
    expect(fake.snapBuilds()).toHaveLength(1);
    expect(build).toMatchObject({
      projectId: 'PRB',
      commit: COMMIT,
      branch: 'feat/cart',
      runUlid: run?.ulid,
      jobStatus: 'progress',
      shardTotal: null,
    });
    expect(build?.screenshots).toEqual([
      {
        name: 'home',
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        browser: 'chromium',
        viewport: { width: 1280, height: 720 },
        colorMode: 'light',
        test: {
          automationKey: 'home.spec.ts > home > renders',
          caseDisplayIds: ['PRB-7'],
          titlePath: ['home', 'renders'],
          file: 'home.spec.ts',
          retry: 0,
        },
      },
      expect.objectContaining({ name: 'home-menu' }),
      {
        name: 'cart',
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        browser: 'chromium',
        viewport: { width: 1280, height: 720 },
        colorMode: 'light',
        test: {
          automationKey: 'cart.spec.ts > cart > renders',
          titlePath: ['cart', 'renders'],
          file: 'cart.spec.ts',
          retry: 0,
        },
      },
    ]);
    expect(fake.snapFiles()).toHaveLength(3);
    expect(lines).toContain(
      `info: Sent 3 screenshots to the Snap build #1 (3 new files): ${fake.baseUrl}/projects/PRB/snap/builds/1`,
    );
  });

  it('keeps Snap screenshots out of the result attachments, and failure screenshots out of Snap', async () => {
    const reporter = reporterOf();
    const failure = { name: 'screenshot', contentType: 'image/png', body: png(9) };
    reporter.onTestEnd(
      fakeTest(),
      fakeResult({
        status: 'failed',
        attachments: [...(await snapped(['home', 1])), failure],
      }),
    );

    await reporter.onEnd();

    expect(fake.stagedFiles().map(({ name, type }) => [name, type])).toEqual([
      ['screenshot.png', 'image/png'],
    ]);
    expect(fake.snapBuilds()[0]?.screenshots.map(({ name }) => name)).toEqual(['home']);
    expect(fake.requestsTo('snapUploadFile')).toHaveLength(1);
  });

  it('sends the shard of a sharded run: its index from 0 and the total', async () => {
    const reporter = reporterOf(
      { PROBARA_SNAP_NONCE: 'nightly-7' },
      { shard: { current: 2, total: 3 } },
    );
    reporter.onTestEnd(fakeTest(), fakeResult({ attachments: await snapped(['home', 1]) }));

    await reporter.onEnd();

    expect(fake.requestsTo('snapCreateBuild')[0]?.body).toMatchObject({
      ciNonce: 'nightly-7',
      shard: { index: 1, total: 3 },
    });
    expect(fake.snapBuilds()[0]).toMatchObject({ jobStatus: 'pending', shardTotal: 3 });
  });

  it('finalizes the shard of a sharded run that took no screenshot, with the snap option on', async () => {
    const reporter = reporterOf(
      { PROBARA_SNAP_NONCE: 'nightly-7', PROBARA_SNAP: 'true' },
      { shard: { current: 2, total: 2 } },
    );
    reporter.onTestEnd(fakeTest(), fakeResult());

    await reporter.onEnd();

    expect(fake.requestsTo('snapCreateBuild').map(({ body }) => body)).toMatchObject([
      { ciNonce: 'nightly-7', shard: { index: 1, total: 2 }, files: [] },
    ]);
    expect(fake.requestsTo('snapFinalizeShard').map(({ body }) => body)).toEqual([
      { screenshots: [] },
    ]);
    expect(lines.filter((line) => line.includes('Snap'))).toEqual([]);
  });

  it('sends no Snap request and logs nothing for a sharded run without screenshots and without the snap option', async () => {
    const reporter = reporterOf({}, { shard: { current: 2, total: 2 } });
    reporter.onTestEnd(fakeTest(), fakeResult());

    await reporter.onEnd();

    expect(fake.requests.filter(({ route }) => route.startsWith('snap'))).toEqual([]);
    expect(lines.filter((line) => /snap/i.test(line))).toEqual([]);
  });

  it('uploads the screenshots of a shard without the snap option, and warns once that the build needs it', async () => {
    const reporter = reporterOf(
      { PROBARA_SNAP_NONCE: 'nightly-7' },
      { shard: { current: 1, total: 2 } },
    );
    reporter.onTestEnd(fakeTest(), fakeResult({ attachments: await snapped(['home', 1]) }));

    await reporter.onEnd();

    expect(fake.snapBuilds()[0]?.screenshots.map(({ name }) => name)).toEqual(['home']);
    expect(lines.filter((line) => line.startsWith('warn: '))).toEqual([
      'warn: This sharded run sends Probara Snap screenshots without the snap option: set snap: true (PROBARA_SNAP=true) in every shard, or the build will not complete when a shard takes no screenshot',
    ]);
  });

  it('does not warn about the snap option when it is on, by option or by variable', async () => {
    const byOption = reporterOf(
      { PROBARA_SNAP_NONCE: 'nightly-7' },
      { shard: { current: 1, total: 2 } },
      { snap: true },
    );
    byOption.onTestEnd(fakeTest(), fakeResult({ attachments: await snapped(['home', 1]) }));
    await byOption.onEnd();
    const byVariable = reporterOf(
      { PROBARA_SNAP_NONCE: 'nightly-8', PROBARA_SNAP: 'true' },
      { shard: { current: 1, total: 2 } },
    );
    byVariable.onTestEnd(fakeTest(), fakeResult({ attachments: await snapped(['home', 1]) }));
    await byVariable.onEnd();

    expect(fake.snapBuilds()).toHaveLength(2);
    expect(lines.filter((line) => line.startsWith('warn: '))).toEqual([]);
  });

  it('asks for a nonce only in a sharded run that takes part in Snap', async () => {
    const out = reporterOf({}, { shard: { current: 1, total: 2 } });
    out.onTestEnd(fakeTest(), fakeResult());
    await out.onEnd();
    expect(lines.filter((line) => line.includes('nonce'))).toEqual([]);

    const taking = reporterOf({ PROBARA_SNAP: 'true' }, { shard: { current: 1, total: 2 } });
    taking.onTestEnd(fakeTest(), fakeResult());
    await taking.onEnd();

    expect(lines.filter((line) => line.includes('nonce'))).toEqual([
      'error: Could not send the Snap screenshots: a sharded run needs a nonce its shards share, and this CI gives none: set one (PROBARA_SNAP_NONCE in a reporter) to the same value in every shard',
    ]);
    expect(fake.requests.filter(({ route }) => route.startsWith('snap'))).toEqual([]);
  });

  it('sends the same name taken by two tests as two screenshots of one build', async () => {
    const reporter = reporterOf();
    reporter.onTestEnd(
      fakeTest({ file: 'home.spec.ts', titles: ['home', 'renders'] }),
      fakeResult({ attachments: await snapped(['page', 1]) }),
    );
    reporter.onTestEnd(
      fakeTest({ file: 'cart.spec.ts', titles: ['cart', 'renders'] }),
      fakeResult({ attachments: await snapped(['page', 2]) }),
    );

    await reporter.onEnd();

    expect(fake.snapBuilds()[0]?.screenshots.map(({ name }) => name)).toEqual(['page', 'page']);
    expect(lines.filter((line) => line.startsWith('error: '))).toEqual([]);
  });

  it('sends a run without shards as a build of one shard', async () => {
    const reporter = reporterOf({ PROBARA_SNAP_NONCE: 'nightly-7' });
    reporter.onTestEnd(fakeTest(), fakeResult({ attachments: await snapped(['home', 1]) }));

    await reporter.onEnd();

    expect(fake.requestsTo('snapCreateBuild')[0]?.body).toMatchObject({
      shard: { index: 0, total: 1 },
    });
    expect(fake.snapBuilds()[0]).toMatchObject({ jobStatus: 'progress' });
  });

  it('names the build and its nonce from snapBuildName and snapNonce, or their variables', async () => {
    const byVariable = reporterOf({
      PROBARA_SNAP_BUILD_NAME: 'mobile',
      PROBARA_SNAP_NONCE: 'nightly-7',
    });
    byVariable.onTestEnd(fakeTest(), fakeResult({ attachments: await snapped(['home', 1]) }));
    await byVariable.onEnd();
    const byOption = reporterOf(
      { PROBARA_SNAP_BUILD_NAME: 'mobile', PROBARA_SNAP_NONCE: 'nightly-7' },
      {},
      { snapBuildName: 'desktop', snapNonce: 'nightly-8' },
    );
    byOption.onTestEnd(fakeTest(), fakeResult({ attachments: await snapped(['home', 1]) }));
    await byOption.onEnd();

    expect(
      fake.requestsTo('snapCreateBuild').map((request) => {
        const { name, ciNonce } = request.body as { name: string; ciNonce: string };
        return { name, ciNonce };
      }),
    ).toEqual([
      { name: 'mobile', ciNonce: 'nightly-7' },
      { name: 'desktop', ciNonce: 'nightly-8' },
    ]);
  });

  it('turns reporting off on a snapNonce that is not a string, naming it', async () => {
    const reporter = reporterOf({}, {}, { snapNonce: 7 as unknown as string });
    reporter.onTestEnd(fakeTest(), fakeResult({ attachments: await snapped(['home', 1]) }));
    await reporter.onEnd();

    expect(lines).toEqual(['error: Probara reporting is off: snapNonce must be a string']);
    expect(fake.requests).toEqual([]);
  });

  it('sends the screenshots of the last attempt of a retried test, with its retry', async () => {
    const reporter = reporterOf();
    const test = fakeTest();
    reporter.onTestEnd(
      test,
      fakeResult({ status: 'failed', attachments: await snapped(['home', 1], ['menu', 2]) }),
    );
    reporter.onTestEnd(test, fakeResult({ retry: 1, attachments: await snapped(['home', 3]) }));

    await reporter.onEnd();

    expect(
      fake
        .snapBuilds()[0]
        ?.screenshots.map(({ name, test: taken }) => [name, (taken as { retry: number }).retry]),
    ).toEqual([['home', 1]]);
    expect(fake.requestsTo('snapUploadFile')).toHaveLength(1);
  });

  it('sends no Snap request and logs no Snap line for a run without screenshots, or while reporting is off', async () => {
    const reporter = reporterOf();
    reporter.onTestEnd(fakeTest(), fakeResult());
    await reporter.onEnd();
    const off = reporterOf({ PROBARA_ENABLED: 'false' });
    off.onTestEnd(fakeTest(), fakeResult({ attachments: await snapped(['home', 1]) }));
    await off.onEnd();

    expect(fake.requests.filter(({ route }) => route.startsWith('snap'))).toEqual([]);
    expect(lines.filter((line) => line.includes('Snap'))).toEqual([]);
  });

  it('logs what Probara says at the screenshot limit of the plan, and never throws into Playwright', async () => {
    await fake.close();
    fake = await startFakeProbara({ token: TOKEN, snapScreenshotAllowance: 0 });
    const reporter = reporterOf();
    reporter.onTestEnd(fakeTest(), fakeResult({ attachments: await snapped(['home', 1]) }));

    await expect(reporter.onEnd()).resolves.toBeUndefined();

    expect(lines.filter((line) => line.startsWith('error: '))).toEqual([
      'error: Could not send the Snap screenshots: Probara answered 409 snap_screenshot_limit_reached: The monthly Snap screenshot allowance of the plan is used up',
    ]);
    expect(fake.runs().map((run) => run.results.length)).toEqual([1]);
    expect(lines.join('\n')).not.toContain(TOKEN);
  });
});
