import { describe, expect, it } from 'vitest';
import type { Logger } from './logger.js';
import { waitForSnapBuild, type WaitSnapOptions } from './snap-wait.js';

const TOKEN = 'probara_live_S3CRETtoken';
const BASE_URL = 'https://app.probara.test';
const BUILDS = `${BASE_URL}/api/v1/projects/SHOP/snap/builds`;
const ULID = '01J9Z3K4M5N6P7Q8R9S0T1V2B1';
const BUILD_URL = `${BASE_URL}/projects/SHOP/snap/${ULID}`;
const COMMIT = 'a'.repeat(40);
const ENV = { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_BASE_URL: BASE_URL };
const COUNTS = { pending: 0, added: 0, removed: 0, unchanged: 3, changed: 0, error: 0 };

type Build = Record<string, unknown>;

function build(fields: Build = {}): Build {
  return {
    ulid: ULID,
    number: 4,
    name: 'default',
    commit: COMMIT,
    jobStatus: 'progress',
    conclusion: null,
    reviewStatus: null,
    errorCode: null,
    diffCounts: COUNTS,
    screenshotCount: 3,
    url: BUILD_URL,
    ciNonce: null,
    ...fields,
  };
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A Snap API in memory: `builds` are listed newest first by their filters, and each read of a build
 * answers the next of `states` (the last one again once they run out). The clock moves only when
 * the wait sleeps.
 */
function setup(builds: Build[], states: Build[] = [], options: Partial<WaitSnapOptions> = {}) {
  const urls: string[] = [];
  const sleeps: number[] = [];
  const lines: string[] = [];
  let clock = Date.parse('2026-11-22T10:00:00Z');
  let reads = 0;
  const logger: Logger = {
    debug: (message) => lines.push(`debug: ${message}`),
    info: (message) => lines.push(`info: ${message}`),
    warn: (message) => lines.push(`warn: ${message}`),
    error: (message) => lines.push(`error: ${message}`),
  };
  const fetchImpl: typeof fetch = (input) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    urls.push(`${url.pathname}${url.search}`);
    if (url.href.startsWith(`${BUILDS}?`)) {
      const items = builds.filter((candidate) =>
        [...url.searchParams].every(
          ([name, value]) => name === 'limit' || String(candidate[name]) === value,
        ),
      );
      return Promise.resolve(json(200, { items: items.slice(0, 1), nextCursor: null }));
    }
    const found = builds.find((candidate) =>
      url.pathname.endsWith(`/${String(candidate['ulid'])}`),
    );
    if (found === undefined) {
      return Promise.resolve(json(404, { error: { code: 'not_found', message: 'no such build' } }));
    }
    const state = states[Math.min(reads, states.length - 1)] ?? found;
    reads += 1;
    return Promise.resolve(json(200, state));
  };
  const wait = () =>
    waitForSnapBuild({
      env: ENV,
      fetch: fetchImpl,
      random: () => 0,
      logger,
      now: () => new Date(clock),
      sleep: (ms: number) => {
        sleeps.push(ms);
        clock += ms;
        return Promise.resolve();
      },
      ...options,
    });
  return {
    wait,
    urls,
    sleeps,
    lines,
    loud: () => lines.filter((line) => !line.startsWith('debug: ')),
  };
}

const complete = (fields: Build = {}) =>
  build({ jobStatus: 'complete', conclusion: 'no-changes', ...fields });

describe('waitForSnapBuild', () => {
  it('reads the build of --build every interval until it is complete', async () => {
    const { wait, urls, sleeps, loud } = setup([build()], [build(), build(), complete()], {
      buildUlid: ULID,
    });

    const summary = await wait();

    expect(summary).toEqual({ status: 'complete', build: complete(), unacceptedChanges: false });
    expect(urls).toEqual(Array(3).fill(`/api/v1/projects/SHOP/snap/builds/${ULID}`));
    expect(sleeps).toEqual([5000, 5000]);
    expect(loud()).toEqual([
      `info: Waiting for the Snap build #4: ${BUILD_URL}`,
      `info: The Snap build #4 is complete: no visual changes: ${BUILD_URL}`,
    ]);
  });

  it('finds the build by its name and the nonce that was set, then reads it', async () => {
    const named = { name: 'mobile', ciNonce: 'nightly-7' };
    const { wait, urls } = setup([build(named)], [complete(named)], {
      nonce: 'nightly-7',
      buildName: 'mobile',
    });

    const summary = await wait();

    expect(summary.status).toBe('complete');
    expect(urls).toEqual([
      '/api/v1/projects/SHOP/snap/builds?name=mobile&ciNonce=nightly-7&limit=1',
      `/api/v1/projects/SHOP/snap/builds/${ULID}`,
    ]);
  });

  it('finds the build by the nonce of the CI, else by the commit and the name of a build sent without one', async () => {
    const github = { ...ENV, GITHUB_ACTIONS: 'true', GITHUB_SHA: COMMIT, GITHUB_RUN_ID: '9876' };
    const sharded = setup([build({ ciNonce: '9876-1' })], [complete()], { env: github });
    const whole = setup([build()], [complete()], { env: github });

    expect((await sharded.wait()).status).toBe('complete');
    expect((await whole.wait()).status).toBe('complete');

    expect(sharded.urls[0]).toBe(
      '/api/v1/projects/SHOP/snap/builds?name=default&ciNonce=9876-1&limit=1',
    );
    expect(whole.urls).toEqual([
      '/api/v1/projects/SHOP/snap/builds?name=default&ciNonce=9876-1&limit=1',
      `/api/v1/projects/SHOP/snap/builds?name=default&commit=${COMMIT}&limit=1`,
      `/api/v1/projects/SHOP/snap/builds/${ULID}`,
    ]);
  });

  it('finds the build by PROBARA_COMMIT and the name outside a CI that gives a nonce', async () => {
    const { wait, urls } = setup([build({ commit: 'b'.repeat(40) })], [complete()], {
      env: { ...ENV, PROBARA_COMMIT: 'B'.repeat(40) },
    });

    expect((await wait()).status).toBe('complete');
    expect(urls[0]).toBe(
      `/api/v1/projects/SHOP/snap/builds?name=default&commit=${'b'.repeat(40)}&limit=1`,
    );
  });

  it('says whether a complete build has changes its review did not accept', async () => {
    const changes = {
      conclusion: 'changes-detected',
      diffCounts: { ...COUNTS, changed: 2, added: 1 },
    };
    const outcomes = [];
    for (const reviewStatus of [null, 'rejected', 'accepted']) {
      const { wait, loud } = setup([build()], [complete({ ...changes, reviewStatus })], {
        buildUlid: ULID,
      });
      const summary = await wait();
      outcomes.push([summary.unacceptedChanges, loud().at(-1)]);
    }

    expect(outcomes).toEqual([
      [
        true,
        `info: The Snap build #4 is complete: 2 changed, 1 added, 0 removed, waiting for review: ${BUILD_URL}`,
      ],
      [true, `info: The Snap build #4 is complete: changes rejected: ${BUILD_URL}`],
      [false, `info: The Snap build #4 is complete: changes accepted: ${BUILD_URL}`],
    ]);
  });

  it('stops at a build that ended with an error or expired', async () => {
    const failed = setup([build()], [build({ jobStatus: 'error', errorCode: 'diff_failed' })], {
      buildUlid: ULID,
    });
    const expired = setup([build()], [build({ jobStatus: 'expired' })], { buildUlid: ULID });

    expect((await failed.wait()).status).toBe('error');
    expect((await expired.wait()).status).toBe('expired');
    expect(failed.loud()).toEqual([
      `error: The Snap build #4 ended with an error (diff_failed): ${BUILD_URL}`,
    ]);
    expect(expired.loud()).toEqual([
      `error: The Snap build #4 expired before every screenshot arrived: ${BUILD_URL}`,
    ]);
  });

  it('gives up once the timeout passes, its last sleep cut to what is left', async () => {
    const { wait, sleeps, loud } = setup([build()], [], { buildUlid: ULID, waitTimeoutMs: 12_000 });

    const summary = await wait();

    expect(summary).toEqual({ status: 'timeout', build: build() });
    expect(sleeps).toEqual([5000, 5000, 2000]);
    expect(loud().at(-1)).toBe(
      `error: Gave up waiting for the Snap build #4 after 12 seconds: it is still progress: ${BUILD_URL}`,
    );
  });

  it('waits 15 minutes by default', async () => {
    const { wait, sleeps } = setup([build()], [], { buildUlid: ULID });

    expect((await wait()).status).toBe('timeout');
    expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(15 * 60 * 1000);
  });

  it('fails without waiting when no build matches, or Probara refuses the build', async () => {
    const noNonce = setup([build()], [], { nonce: 'nightly-7' });
    const noBuild = setup([], [], { buildUlid: ULID });
    const nothing = setup([], []);

    const byNonce = await noNonce.wait();
    const byUlid = await noBuild.wait();
    const unknown = await nothing.wait();

    expect(byNonce).toEqual({
      status: 'failed',
      error: { message: 'no Snap build named "default" has the nonce "nightly-7"' },
    });
    expect(noNonce.urls).toEqual([
      '/api/v1/projects/SHOP/snap/builds?name=default&ciNonce=nightly-7&limit=1',
    ]);
    expect(byUlid).toMatchObject({ status: 'failed', error: { status: 404, code: 'not_found' } });
    expect(unknown).toEqual({
      status: 'failed',
      error: {
        message:
          'no build names the Snap build: pass its ULID, or a nonce, or set PROBARA_COMMIT to the commit it is of',
      },
    });
    expect(nothing.urls).toEqual([]);
    expect(noNonce.loud()).toEqual([
      'error: Could not wait for the Snap build: no Snap build named "default" has the nonce "nightly-7"',
    ]);
  });

  it('sends nothing while reporting is off, and never logs the token', async () => {
    const off = setup([build()], [], {
      buildUlid: ULID,
      env: { ...ENV, PROBARA_ENABLED: 'false' },
    });

    expect(await off.wait()).toEqual({ status: 'disabled' });
    expect(off.urls).toEqual([]);
    expect(off.lines.join('\n')).not.toContain(TOKEN);
  });
});
