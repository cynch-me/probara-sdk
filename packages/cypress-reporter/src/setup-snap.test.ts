/**
 * Probara Snap in the plugin: the screenshots `cy.probaraSnap` handed over leave the results they travelled with and
 * go out as one build at `after:run`, on a fake of what Cypress hands the plugin, against a fake Probara.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetRun } from './run.js';
import { resultsFile, screenshotsFile, sessionDir, writeJson } from './session-files.js';
import { probaraNodeEvents } from './setup.js';
import { SNAP_CONTENT_TYPE, SNAP_IMAGE_CONTENT_TYPE, SNAP_NAME } from '@probara/core';
import { fakePlugin, type FakePlugin } from '../test/support/cypress-fakes.js';

const TOKEN = 'prb_test_T0KEN_must_never_leak_42';
const SPEC = 'cypress/e2e/cart.cy.js';
const COMMIT = 'a'.repeat(40);
const DIR = sessionDir(process.ppid);

const scratch = mkdtempSync(join(tmpdir(), 'probara-cypress-reporter-snap-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

let fake: FakeProbara;
let lines: string[];
let files = 0;

function fileOf(content: string | Uint8Array): string {
  files += 1;
  const path = join(scratch, `file-${String(files)}`);
  writeFileSync(path, content);
  return path;
}

/** The two attachments `cy.probaraSnap(name)` leaves on an attempt, as the reporter process hands them over. */
function snapped(name: string, seed: number): Record<string, unknown>[] {
  return [
    {
      name: SNAP_NAME,
      contentType: SNAP_CONTENT_TYPE,
      path: fileOf(
        JSON.stringify({ name, viewport: { width: 1000, height: 660 }, colorMode: 'light' }),
      ),
    },
    {
      name: SNAP_NAME,
      contentType: SNAP_IMAGE_CONTENT_TYPE,
      path: fileOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed])),
    },
  ];
}

/** One result of the spec, as a reporter of this package hands it over, with the test it is of. */
function resultOf(
  title: string,
  status: string,
  attachments: Record<string, unknown>[] = [],
  extra: Record<string, unknown> = {},
) {
  return {
    test: JSON.stringify([SPEC, title]),
    input: {
      identity: { file: SPEC, titlePath: [title] },
      status,
      suitePath: [SPEC],
      ...(attachments.length === 0 ? {} : { attachments }),
      ...extra,
    },
  };
}

function plugin(options: Record<string, unknown> = {}, config = {}): FakePlugin {
  const write = (level: string) => (message: string) => {
    lines.push(`${level}: ${message}`);
  };
  const events = fakePlugin(config);
  events.config.reporterOptions = {
    projectId: 'SHOP',
    logger: {
      debug: write('debug'),
      info: write('info'),
      warn: write('warn'),
      error: write('error'),
    },
    env: {
      PROBARA_API_TOKEN: TOKEN,
      PROBARA_PROJECT: 'SHOP',
      PROBARA_BASE_URL: fake.baseUrl,
      PROBARA_COMMIT: COMMIT,
      PROBARA_BRANCH: 'feat/cart',
    },
    ...options,
  };
  return events;
}

/** A whole run of one spec whose reporter handed `results` over. */
async function run(
  events: FakePlugin,
  results: readonly Record<string, unknown>[],
  beforeRun: { browser?: { name?: string }; parallel?: boolean } = {
    browser: { name: 'electron' },
  },
): Promise<void> {
  probaraNodeEvents(events.on, events.config);
  await events.emit('before:run', beforeRun);
  await events.emit('before:spec', { relative: SPEC });
  writeJson(DIR, resultsFile(SPEC), { spec: SPEC, results, ignored: 0 });
  await events.emit(
    'after:spec',
    { relative: SPEC },
    { stats: { tests: 1, failures: 0 }, video: null },
  );
  await events.emit('after:run', { totalDuration: 1 });
}

/** The variables the reporter of a fake plugin reads, to add those of a CI to. */
function reporterEnv(events: FakePlugin): Record<string, string> {
  return (events.config.reporterOptions as { env: Record<string, string> }).env;
}

function snapLines(): string[] {
  return lines.filter((line) => /snap/i.test(line) && !line.startsWith('debug:'));
}

beforeEach(async () => {
  resetRun();
  lines = [];
  fake = await startFakeProbara({ token: TOKEN });
});

afterEach(async () => {
  resetRun();
  await fake.close();
});

describe('the plugin of a run whose tests call cy.probaraSnap', () => {
  it('sends the screenshots as one build of the run, each with its test as the results name it', async () => {
    await run(plugin(), [
      resultOf('Cart adds an item', 'passed', [...snapped('cart', 1), ...snapped('cart-full', 2)]),
      resultOf('Cart pays', 'passed', snapped('cart', 3), { caseDisplayId: 'SHOP-7' }),
    ]);

    const results = fake.reports().flatMap((report) => report.results);
    expect(fake.snapBuilds()).toMatchObject([
      { commit: COMMIT, branch: 'feat/cart', jobStatus: 'progress', runUlid: fake.runs()[0]?.ulid },
    ]);
    expect(fake.snapBuilds()[0]?.screenshots).toMatchObject([
      {
        name: 'cart',
        browser: 'electron',
        viewport: { width: 1000, height: 660 },
        colorMode: 'light',
        test: { automationKey: results[0]?.automationKey, file: SPEC, retry: 0 },
      },
      { name: 'cart-full', test: { automationKey: results[0]?.automationKey } },
      {
        name: 'cart',
        test: { automationKey: results[1]?.automationKey, caseDisplayIds: ['SHOP-7'] },
      },
    ]);
    expect(results.map((result) => result.automationKey)).toEqual([
      `${SPEC} > Cart adds an item`,
      `${SPEC} > Cart pays`,
    ]);
    expect(fake.requestsTo('snapCreateBuild')[0]?.body).not.toHaveProperty('ciNonce');
    expect(snapLines()).toEqual([
      `info: Sent 3 screenshots to the Snap build #1 (3 new files): ${fake.baseUrl}/projects/SHOP/snap/builds/1`,
    ]);
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it('keeps the screenshots out of the attachments of the results, and the other attachments in them', async () => {
    const note = fileOf('a note');
    await run(plugin(), [
      resultOf('Cart adds an item', 'passed', [
        { name: 'note.txt', contentType: 'text/plain', path: note },
        ...snapped('cart', 1),
      ]),
    ]);

    expect(fake.stagedFiles().map((file) => file.type)).toEqual(['text/plain']);
  });

  it('sends the screenshots of the last attempt of a retried test', async () => {
    await run(plugin(), [
      resultOf('Cart adds an item', 'failed', [...snapped('cart', 1), ...snapped('first-only', 2)]),
      resultOf('Cart adds an item', 'passed', snapped('cart', 3)),
    ]);

    const sent = (fake.snapBuilds()[0]?.screenshots ?? []) as unknown as {
      name: string;
      test: { retry: number };
    }[];
    expect(sent.map(({ name, test }) => [name, test.retry])).toEqual([['cart', 1]]);
  });

  it('names the build with snapBuildName', async () => {
    await run(plugin({ snapBuildName: 'mobile' }), [
      resultOf('Cart adds an item', 'passed', snapped('cart', 1)),
    ]);

    expect(fake.snapBuilds().map((build) => build.name)).toEqual(['mobile']);
  });

  it('sends and logs nothing of Snap in a run that took no screenshot', async () => {
    await run(plugin(), [resultOf('Cart adds an item', 'passed')]);

    expect(fake.requests.filter(({ route }) => route.startsWith('snap'))).toEqual([]);
    expect(lines.filter((line) => /snap/i.test(line))).toEqual([]);
  });

  it('joins the build of the nonce without a shard total when snap is on, even from a machine without screenshots', async () => {
    const options = { snap: true, snapNonce: 'pipeline-7' };
    await run(plugin(options), [resultOf('Cart adds an item', 'passed', snapped('cart', 1))]);
    resetRun();
    await run(plugin(options), [resultOf('Home renders', 'passed')]);

    const [build, ...others] = fake.snapBuilds();
    expect(others).toEqual([]);
    expect(build).toMatchObject({ ciNonce: 'pipeline-7', shardTotal: null, jobStatus: 'pending' });
    expect(build?.shards.map((shard) => shard.screenshots?.length)).toEqual([1, 0]);
    expect(fake.requestsTo('snapCreateBuild').map(({ body }) => body)).toEqual([
      expect.not.objectContaining({ shard: expect.anything() as unknown }),
      expect.not.objectContaining({ shard: expect.anything() as unknown }),
    ]);
    expect(snapLines()).toEqual([
      `info: Sent 1 screenshot to the Snap build #1 (1 new file), which waits for "probara snap finalize": ${fake.baseUrl}/projects/SHOP/snap/builds/1`,
    ]);
  });

  it('takes the nonce the CI gives, or PROBARA_SNAP_NONCE, when snap is on', async () => {
    const ci = plugin({ snap: true });
    Object.assign(reporterEnv(ci), { GITLAB_CI: 'true', CI_PIPELINE_ID: '4521' });
    await run(ci, [resultOf('Cart adds an item', 'passed', snapped('cart', 1))]);
    resetRun();
    const named = plugin();
    Object.assign(reporterEnv(named), { PROBARA_SNAP: 'true', PROBARA_SNAP_NONCE: 'nightly-7' });
    await run(named, [resultOf('Cart adds an item', 'passed', snapped('cart', 2))]);

    expect(fake.snapBuilds().map((build) => [build.ciNonce, build.shardTotal])).toEqual([
      ['4521', null],
      ['nightly-7', null],
    ]);
  });

  it('sends no build when snap is on and nothing names the nonce, and says how to set one', async () => {
    await run(plugin({ snap: true }), [
      resultOf('Cart adds an item', 'passed', snapped('cart', 1)),
    ]);

    expect(fake.requests.filter(({ route }) => route.startsWith('snap'))).toEqual([]);
    expect(snapLines()).toEqual([
      'error: Could not send the Snap screenshots: a run split across machines needs a nonce its machines share, and this CI gives none: set one (PROBARA_SNAP_NONCE in a reporter) to the same value on every machine',
    ]);
  });

  it('joins the build of the run from a machine of a parallel run without the snap option, and warns once', async () => {
    const events = plugin();
    Object.assign(reporterEnv(events), { GITLAB_CI: 'true', CI_PIPELINE_ID: '4521' });
    await run(events, [resultOf('Cart adds an item', 'passed', snapped('cart', 1))], {
      browser: { name: 'electron' },
      parallel: true,
    });

    expect(
      fake.snapBuilds().map((build) => [build.ciNonce, build.shardTotal, build.jobStatus]),
    ).toEqual([['4521', null, 'pending']]);
    expect(snapLines()).toEqual([
      'warn: This parallel run sends Probara Snap screenshots without the snap option: set snap: true (PROBARA_SNAP=true) on every machine, or "probara snap finalize" finds no build when no machine takes a screenshot',
      `info: Sent 1 screenshot to the Snap build #1 (1 new file), which waits for "probara snap finalize": ${fake.baseUrl}/projects/SHOP/snap/builds/1`,
    ]);
  });

  it('sends and logs nothing of Snap from a machine of a parallel run that took no screenshot, without the snap option', async () => {
    await run(plugin(), [resultOf('Cart adds an item', 'passed')], {
      browser: { name: 'electron' },
      parallel: true,
    });

    expect(fake.requests.filter(({ route }) => route.startsWith('snap'))).toEqual([]);
    expect(lines.filter((line) => /snap/i.test(line))).toEqual([]);
  });

  it('sends no build from cypress open, with the snap option too', async () => {
    const events = plugin({ snap: true, snapNonce: 'pipeline-7' }, { isInteractive: true });
    await run(events, [resultOf('Cart adds an item', 'passed', snapped('cart', 1))]);

    expect(fake.requests.filter(({ route }) => route.startsWith('snap'))).toEqual([]);
  });

  it('turns reporting off on a snap option that is no boolean, naming it', async () => {
    await run(plugin({ snap: 'yes' }), [
      resultOf('Cart adds an item', 'passed', snapped('cart', 1)),
    ]);

    expect(fake.requests).toEqual([]);
    expect(lines.filter((line) => line.startsWith('error:'))).toEqual([
      'error: Probara reporting is off: snap must be true or false',
    ]);
  });

  it('tells the browser to capture in cypress run, and not in cypress open', () => {
    const headless = plugin();
    probaraNodeEvents(headless.on, headless.config);
    expect(headless.config.expose?.probara).toMatchObject({ snap: true });

    resetRun();
    const interactive = plugin({}, { isInteractive: true });
    probaraNodeEvents(interactive.on, interactive.config);
    expect(interactive.config.expose?.probara).toMatchObject({ snap: false });
  });

  it('keeps the capture out of the screenshots of failures, which stay attachments', async () => {
    const events = plugin();
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:run', { browser: { name: 'electron' } });
    await events.emit('before:spec', { relative: SPEC });
    await events.emit('after:screenshot', {
      path: '/work/app/cypress/screenshots/cart.cy.js/probara-snap/7f1c.png',
      name: 'probara-snap/7f1c',
      testFailure: false,
    });
    await events.emit('after:screenshot', {
      path: '/work/app/cypress/screenshots/cart.cy.js/Cart -- adds an item (failed).png',
      testFailure: true,
    });

    const kept = JSON.parse(readFileSync(join(DIR, screenshotsFile(SPEC)), 'utf8')) as {
      path: string;
    }[];
    expect(kept.map((shot) => shot.path)).toEqual([
      '/work/app/cypress/screenshots/cart.cy.js/Cart -- adds an item (failed).png',
    ]);
  });
});
