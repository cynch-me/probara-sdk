import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runInNewContext, Script } from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeVisApi, type FakeVisApi } from './support/fake-vis.js';
import {
  startFakeCdp,
  type FakeCdp,
  type FakeCdpOptions,
  type FakePage,
} from './support/fake-cdp.js';
import { runCli, TOKEN, type CliRun } from './support/run-cli.js';
import type { StopSignals } from '../src/main.js';
import { pageScript } from '../src/vis/page-script.js';

const BASE_URL = 'https://probara.test';
const ENV = { PROBARA_API_TOKEN: TOKEN, PROBARA_BASE_URL: BASE_URL };
/** When the page's engine started recording (epoch ms). */
const T0 = 1_767_225_700_000;
const CHECKOUT = {
  id: 'PAGE-CHECKOUT',
  url: 'https://shop.example.com/checkout',
  title: 'Checkout',
};
const ADMIN = { id: 'PAGE-ADMIN', url: 'https://admin.example.com/', title: 'Admin' };

const meta = (ts: number) => ({
  type: 4,
  timestamp: ts,
  data: { href: CHECKOUT.url, width: 1280, height: 720 },
});
const snapshot = (ts: number) => ({
  type: 2,
  timestamp: ts,
  data: { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { top: 0, left: 0 } },
});
const move = (ts: number) => ({
  type: 3,
  timestamp: ts,
  data: { source: 1, positions: [{ x: 1, y: 2, id: 1, timeOffset: 0 }] },
});
const consoleEntry = (ts: number, text: string) => ({ t: 5, ts, level: 'error', args: [text] });
const networkEntry = (ts: number) => ({
  t: 5,
  ts,
  id: 'r1',
  kind: 'fetch',
  method: 'POST',
  url: 'https://shop.example.com/api/pay?token=abc123secret',
  status: 402,
  requestHeaders: { authorization: 'Bearer secret-123' },
  responseHeaders: {},
  requestBody: null,
  responseBody: null,
  durationMs: 12,
  timing: null,
  error: null,
  graphql: null,
});
const click = (ts: number) => ({
  t: 5,
  ts,
  type: 'click',
  target: { selector: 'button#pay', text: 'Pay', tag: 'button' },
  url: CHECKOUT.url,
  x: 10,
  y: 20,
});
const ENVIRONMENT = {
  pageUrl: CHECKOUT.url,
  pageTitle: 'Checkout',
  environment: {
    browser: { name: 'Chrome', version: '140.0' },
    os: { name: 'macOS', version: '15.1' },
    device: 'desktop',
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
  },
};

let api: FakeVisApi;
let cdp: FakeCdp | undefined;

beforeEach(() => {
  api = createFakeVisApi({ token: TOKEN });
});

afterEach(async () => {
  await cdp?.close();
  cdp = undefined;
});

async function browser(options: FakeCdpOptions): Promise<FakeCdp> {
  cdp = await startFakeCdp(options);
  return cdp;
}

async function probara(
  args: readonly string[],
  options: { env?: Record<string, string | undefined>; stopSignals?: StopSignals } = {},
): Promise<CliRun> {
  const run = await runCli(['vis', 'record', ...args], {
    env: options.env ?? ENV,
    fetch: api.fetch,
    ...(options.stopSignals === undefined ? {} : { stopSignals: options.stopSignals }),
  });
  expect(run.stdout).not.toContain(TOKEN);
  expect(run.stderr).not.toContain(TOKEN);
  if (cdp !== undefined) {
    // The browser only ever receives the capture script: never the token.
    expect(JSON.stringify(cdp.commands())).not.toContain(TOKEN);
  }
  return run;
}

function lines(visUlid: string, kind: string): Record<string, unknown>[] {
  const stored = api.asset(visUlid, kind);
  if (stored === undefined) return [];
  return new TextDecoder()
    .decode(gunzipSync(stored.bytes))
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Sends a whole recording, across a navigation, then closes the tab. */
async function recordAndClose(page: FakePage): Promise<void> {
  page.send({ kind: 'replay', events: [meta(T0), snapshot(T0 + 1)] });
  page.send({ kind: 'environment', environment: ENVIRONMENT });
  page.send({ kind: 'console', entry: consoleEntry(T0 + 500, 'Payment failed') });
  page.send({ kind: 'network', entry: networkEntry(T0 + 800) });
  page.send({ kind: 'events', entry: click(T0 + 900) });
  page.send({ kind: 'replay', events: [move(T0 + 1200)] });
  // The page navigated: the new document records again from a full snapshot.
  page.send({ kind: 'replay', events: [meta(T0 + 3000), snapshot(T0 + 3001), move(T0 + 4000)] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  page.close();
}

describe('probara vis record', () => {
  it('records the page over CDP until the tab closes, and creates a replay Vis with its diagnostics and environment', async () => {
    const fake = await browser({ pages: [CHECKOUT], onInject: recordAndClose });

    const run = await probara([
      '--cdp',
      fake.httpUrl,
      '--folder',
      '01KF0000000000000000000001',
      '--private',
      '--description',
      'Found by the checkout agent',
      '--metadata',
      'build=1.42.0',
    ]);

    expect(run.exitCode, run.stderr).toBe(0);
    const [vis] = api.vises();
    expect(vis).toMatchObject({
      title: 'Checkout',
      kind: 'replay',
      source: 'cli',
      status: 'ready',
      durationMs: 4000,
      capturedAt: T0,
      pageUrl: CHECKOUT.url,
      pageTitle: 'Checkout',
      environment: ENVIRONMENT.environment,
      folderUlid: '01KF0000000000000000000001',
      accessMode: 'private',
      description: 'Found by the checkout agent',
      metadata: { build: '1.42.0' },
    });
    expect(run.stdout).toBe(`${vis?.ulid ?? ''} VIS-1 https://probara.test/vis/VIS-1\n`);
    expect(run.stderr).toContain('Recording "Checkout" (https://shop.example.com/checkout)');
    expect(run.stderr).toContain('The page closed: the recording ends');
    expect(run.stderr).toContain('Uploaded VIS-1: https://probara.test/vis/VIS-1');

    const replay = api.asset(vis?.ulid ?? '', 'replay');
    expect(replay).toMatchObject({ contentType: 'application/x-ndjson', contentEncoding: 'gzip' });
    expect(lines(vis?.ulid ?? '', 'replay')).toEqual([
      meta(T0),
      snapshot(T0 + 1),
      move(T0 + 1200),
      meta(T0 + 3000),
      snapshot(T0 + 3001),
      move(T0 + 4000),
    ]);
    // Every line is timed from the start of the replay, whatever the page stamped.
    expect(lines(vis?.ulid ?? '', 'console')).toEqual([
      { t: 500, ts: T0 + 500, level: 'error', args: ['Payment failed'] },
    ]);
    const [request] = lines(vis?.ulid ?? '', 'network');
    expect(request?.t).toBe(800);
    expect(request?.url).not.toContain('abc123secret');
    expect(JSON.stringify(request)).not.toContain('secret-123');
    expect(lines(vis?.ulid ?? '', 'events')).toEqual([{ ...click(T0 + 900), t: 900 }]);
  });

  it('injects the engine into the page and into every document it navigates to, through a binding only it holds', async () => {
    const fake = await browser({ pages: [CHECKOUT], onInject: recordAndClose });

    const run = await probara(['--cdp', fake.httpUrl]);

    expect(run.exitCode, run.stderr).toBe(0);
    const [source] = fake.newDocumentScripts();
    const [binding] = fake.bindings();
    expect(fake.injected()).toEqual([{ pageId: CHECKOUT.id, source }]);
    expect(source).toContain('ProbaraVisCaptureReplay');
    expect(source).toContain('ProbaraVisCapture=');
    expect(binding).toMatch(/^__probaraVis[0-9a-f]{16}$/);
    expect(source).toContain(binding);
    expect(source).not.toContain(TOKEN);
    // The browser runs it as a script: it must parse, the engine's bundled worker strings included.
    expect(() => new Script(source ?? '')).not.toThrow();
  });

  it('stops at --duration and never reports a length above it, even when the timer fires late', async () => {
    const fake = await browser({
      pages: [CHECKOUT],
      onInject: (page) => {
        page.send({ kind: 'replay', events: [meta(T0), snapshot(T0 + 1), move(T0 + 1000)] });
        page.send({ kind: 'console', entry: consoleEntry(T0 + 1003, 'after the end') });
      },
      // What the page flushes when it is stopped, a few milliseconds past the limit.
      onStop: (page) => {
        page.send({ kind: 'replay', events: [move(T0 + 999), move(T0 + 1004)] });
      },
    });

    const run = await probara(['--cdp', fake.httpUrl, '--duration', '1', '--title', 'One second']);

    expect(run.exitCode, run.stderr).toBe(0);
    const [vis] = api.vises();
    expect(vis).toMatchObject({ title: 'One second', durationMs: 1000 });
    const replayed = lines(vis?.ulid ?? '', 'replay').map((event) => event.timestamp);
    expect(replayed).toEqual([T0, T0 + 1, T0 + 1000, T0 + 999]);
    expect(lines(vis?.ulid ?? '', 'console')).toEqual([]);
    expect(run.stderr).toContain('Reached --duration (1 s): the recording ends');
    const methods = fake.commands().map((command) => command.method);
    expect(methods).toContain('Page.removeScriptToEvaluateOnNewDocument');
    expect(methods).toContain('Runtime.removeBinding');
  });

  it("cuts a recording longer than the plan's limit to the limit, and reports the limit", async () => {
    api = createFakeVisApi({ token: TOKEN, recordingMaxMinutes: 1 });
    const fake = await browser({
      pages: [CHECKOUT],
      onInject: async (page) => {
        page.send({ kind: 'replay', events: [meta(T0), snapshot(T0 + 1), move(T0 + 30_000)] });
        page.send({ kind: 'console', entry: consoleEntry(T0 + 59_000, 'kept') });
        page.send({ kind: 'console', entry: consoleEntry(T0 + 61_000, 'cut') });
        page.send({ kind: 'replay', events: [move(T0 + 60_000), move(T0 + 90_000)] });
        await new Promise((resolve) => setTimeout(resolve, 20));
        page.close();
      },
    });

    const run = await probara(['--cdp', fake.httpUrl]);

    expect(run.exitCode, run.stderr).toBe(0);
    const [vis] = api.vises();
    expect(vis).toMatchObject({ status: 'ready', durationMs: 60_000 });
    expect(lines(vis?.ulid ?? '', 'replay').map((event) => event.timestamp)).toEqual([
      T0,
      T0 + 1,
      T0 + 30_000,
      T0 + 60_000,
    ]);
    expect(lines(vis?.ulid ?? '', 'console').map((entry) => entry.args)).toEqual([['kept']]);
    expect(run.stderr).toContain(
      'The plan records at most 1 minute: the Vis keeps the first 1 minute of the recording',
    );
    expect(api.openUploads()).toBe(0);
  });

  it('stops on SIGINT or SIGTERM, uploads what was recorded, and lets go of the signals', async () => {
    let listener: ((signal: string) => void) | undefined;
    const stopSignals: StopSignals = (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    };
    const fake = await browser({
      pages: [CHECKOUT],
      onInject: async (page) => {
        page.send({ kind: 'replay', events: [meta(T0), snapshot(T0 + 1), move(T0 + 2500)] });
        await new Promise((resolve) => setTimeout(resolve, 20));
        listener?.('SIGTERM');
      },
    });

    const run = await probara(['--cdp', fake.httpUrl], { stopSignals });

    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stderr).toContain('SIGTERM: the recording ends');
    expect(api.vises()[0]).toMatchObject({ status: 'ready', durationMs: 2500 });
    expect(listener).toBeUndefined();
  });

  it('validates and bounds what the page sends: malformed, oversized or forged messages are dropped', async () => {
    const fake = await browser({
      pages: [CHECKOUT],
      onInject: async (page) => {
        page.send({ kind: 'replay', events: [meta(T0), snapshot(T0 + 1)] });
        page.send('not json');
        page.send(
          JSON.stringify({ kind: 'console', entry: consoleEntry(T0 + 2, 'x'.repeat(10)) }) +
            ' '.repeat(32 * 1024 * 1024),
        );
        // A console message dressed as a request, and the other way round.
        page.send({ kind: 'network', entry: consoleEntry(T0 + 3, 'forged') });
        page.send({ kind: 'console', entry: networkEntry(T0 + 4) });
        page.send({ kind: 'events', entry: { ...click(T0 + 5), type: 'exfiltrate' } });
        page.send({ kind: 'screenshot', entry: {} });
        page.send({
          kind: 'replay',
          events: [{ type: 99, timestamp: T0 + 6, data: {} }, { type: 3 }, 'x'],
        });
        page.send({
          kind: 'environment',
          environment: { environment: { country: 'XX', device: 'desktop', extra: 1 } },
        });
        page.send({
          kind: 'console',
          entry: { ...consoleEntry(T0 + 7, 'kept'), injected: 'dropped field' },
        });
        for (let index = 0; index < 5100; index += 1) {
          page.send({
            kind: 'console',
            entry: consoleEntry(T0 + 10 + index, `log ${String(index)}`),
          });
        }
        page.send({ kind: 'replay', events: [move(T0 + 6000)] });
        await new Promise((resolve) => setTimeout(resolve, 50));
        page.close();
      },
    });

    const run = await probara(['--cdp', fake.httpUrl]);

    expect(run.exitCode, run.stderr).toBe(0);
    const [vis] = api.vises();
    expect(lines(vis?.ulid ?? '', 'replay').map((event) => event.type)).toEqual([4, 2, 3]);
    const consoleLines = lines(vis?.ulid ?? '', 'console');
    // The engine's buffer keeps the newest 5000 console entries.
    expect(consoleLines).toHaveLength(5000);
    expect(consoleLines.at(-1)).toEqual({
      t: 5109,
      ts: T0 + 5109,
      level: 'error',
      args: ['log 5099'],
    });
    expect(consoleLines.some((entry) => 'injected' in entry)).toBe(false);
    expect(lines(vis?.ulid ?? '', 'network')).toEqual([]);
    expect(lines(vis?.ulid ?? '', 'events')).toEqual([]);
    expect(vis?.environment).toEqual({ device: 'desktop' });
    expect(run.stderr).toContain(
      'Ignored 7 messages from the page that were not valid capture data',
    );
    expect(run.stderr).toContain('Kept the newest console entries: 101 older ones were dropped');
  });

  it('creates nothing on Probara when nothing was captured', async () => {
    const fake = await browser({
      pages: [CHECKOUT],
      onInject: (page) => {
        page.close();
      },
    });

    const run = await probara(['--cdp', fake.httpUrl]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Nothing was captured: no Vis was created');
    expect(api.requests()).toEqual([]);
  });

  it('reports a capture script that fails in the page, and creates nothing', async () => {
    const fake = await browser({
      pages: [CHECKOUT],
      injectionError: 'TypeError: window.WeakRef is not a constructor',
    });

    const run = await probara(['--cdp', fake.httpUrl]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      'The recording failed: the capture script failed in the page (TypeError: window.WeakRef is not a constructor)',
    );
    expect(api.requests()).toEqual([]);
  });

  it('deletes the Vis again when an upload fails after it was created', async () => {
    api.fail('PUT', /\/parts\/1$/, 400, {
      error: { code: 'validation_failed', message: 'bad part' },
    });
    const fake = await browser({ pages: [CHECKOUT], onInject: recordAndClose });

    const run = await probara(['--cdp', fake.httpUrl]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Probara answered 400 validation_failed: bad part');
    expect(run.stderr).toContain('Deleted the pending VIS-1: nothing was left behind');
    expect(api.vises()).toEqual([]);
    expect(run.stdout).toBe('');
  });

  it('records the only page, or the one --target names, and lists the pages when the choice is unclear', async () => {
    const fake = await browser({
      pages: [
        CHECKOUT,
        ADMIN,
        { id: 'SW-1', url: 'https://shop.example.com/sw.js', title: '', type: 'service_worker' },
      ],
      onInject: recordAndClose,
    });

    const unclear = await probara(['--cdp', fake.httpUrl]);
    expect(unclear.exitCode).toBe(2);
    expect(unclear.stderr).toContain(
      'The browser has 2 pages: pass --target with the id of one, or part of its URL',
    );
    expect(unclear.stderr).toContain(`  ${CHECKOUT.id}  ${CHECKOUT.url}  Checkout`);
    expect(unclear.stderr).toContain(`  ${ADMIN.id}  ${ADMIN.url}  Admin`);
    expect(unclear.stderr).not.toContain('sw.js');

    const unknown = await probara(['--cdp', fake.httpUrl, '--target', 'billing']);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr).toContain('No page matches --target "billing"');
    expect(fake.injected()).toEqual([]);
    expect(api.requests()).toEqual([]);

    const chosen = await probara(['--cdp', fake.httpUrl, '--target', 'admin.example']);
    expect(chosen.exitCode, chosen.stderr).toBe(0);
    expect(fake.injected().map((item) => item.pageId)).toEqual([ADMIN.id]);
  });

  it("attaches to a page's own WebSocket debugger URL", async () => {
    const fake = await browser({ pages: [CHECKOUT], onInject: recordAndClose });

    const run = await probara(['--cdp', fake.pageUrl(CHECKOUT.id)]);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(fake.commands().map((command) => command.method)).not.toContain('Target.getTargets');
    expect(api.vises()[0]).toMatchObject({ kind: 'replay', durationMs: 4000 });

    const both = await probara(['--cdp', fake.pageUrl(CHECKOUT.id), '--target', 'checkout']);
    expect(both.exitCode).toBe(2);
    expect(both.stderr).toContain('--target picks a page of a browser endpoint');
  });

  it('prints the Vis with its url as JSON with --json', async () => {
    const fake = await browser({ pages: [CHECKOUT], onInject: recordAndClose });

    const run = await probara(['--cdp', fake.httpUrl, '--json']);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      displayId: 'VIS-1',
      kind: 'replay',
      url: 'https://probara.test/vis/VIS-1',
    });
  });

  it('is a usage error without --cdp or with an endpoint that is no CDP endpoint, and 1 when the browser cannot be reached', async () => {
    const missing = await probara([]);
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain('Missing --cdp');

    const scheme = await probara(['--cdp', 'ftp://127.0.0.1:9222']);
    expect(scheme.exitCode).toBe(2);
    expect(scheme.stderr).toContain('--cdp must be an http, https, ws or wss URL');

    const zero = await probara(['--cdp', 'http://127.0.0.1:9222', '--duration', '0']);
    expect(zero.exitCode).toBe(2);

    const unreachable = await probara(['--cdp', 'http://127.0.0.1:1']);
    expect(unreachable.exitCode).toBe(1);
    expect(unreachable.stderr).toContain('Could not reach the browser at http://127.0.0.1:1');
    expect(api.requests()).toEqual([]);
  });

  it('records nothing and sends nothing while reporting is off', async () => {
    const fake = await browser({ pages: [CHECKOUT], onInject: recordAndClose });

    const run = await probara(['--cdp', fake.httpUrl], {
      env: { ...ENV, PROBARA_ENABLED: 'false' },
    });

    expect(run.exitCode).toBe(0);
    expect(fake.commands()).toEqual([]);
    expect(api.requests()).toEqual([]);
  });
});

/** The temporary directories of `vis record` that exist now. */
function recordDirs(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('probara-vis-record-'));
}

/** JSON nested `depth` objects deep: more than JSON.stringify can walk. */
function deepJson(depth: number): string {
  return `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`;
}

/** Signals a test sends itself, as the terminal would. */
function signals() {
  let listener: ((signal: string) => void) | undefined;
  const stopSignals: StopSignals = (next) => {
    listener = next;
    return () => {
      listener = undefined;
    };
  };
  return {
    stopSignals,
    send: (signal: string) => listener?.(signal),
    get listening() {
      return listener !== undefined;
    },
  };
}

describe('probara vis record: the length and the cut', () => {
  it('keeps what a still page logged after its last replay event, and lasts until the recording stopped', async () => {
    const fake = await browser({
      pages: [CHECKOUT],
      onInject: async (page) => {
        page.send({ kind: 'replay', events: [meta(T0), snapshot(T0 + 1)] });
        page.send({ kind: 'console', entry: consoleEntry(T0 + 2500, 'late error') });
        page.send({ kind: 'network', entry: networkEntry(T0 + 3000) });
        // The page reports its clock while nothing on it moves.
        page.send({ kind: 'clock', ts: T0 + 4000 });
        page.send({ kind: 'clock', ts: T0 + 6000 });
        await new Promise((resolve) => setTimeout(resolve, 20));
        page.close();
      },
    });

    const run = await probara(['--cdp', fake.httpUrl]);

    expect(run.exitCode, run.stderr).toBe(0);
    const [vis] = api.vises();
    expect(vis).toMatchObject({ status: 'ready', durationMs: 6000 });
    expect(run.stderr).toContain('Recorded 6.0 s: 2 replay events, 1 console message, 1 request');
    expect(lines(vis?.ulid ?? '', 'console').map((entry) => entry.t)).toEqual([2500]);
    expect(lines(vis?.ulid ?? '', 'network').map((entry) => entry.t)).toEqual([3000]);
    expect(run.stderr).not.toContain('Ignored');
  });

  it("cuts every stream at the plan's limit, and keeps what came before it after the last replay event", async () => {
    api = createFakeVisApi({ token: TOKEN, recordingMaxMinutes: 1 });
    const fake = await browser({
      pages: [CHECKOUT],
      onInject: async (page) => {
        page.send({ kind: 'replay', events: [meta(T0), snapshot(T0 + 1)] });
        page.send({ kind: 'console', entry: consoleEntry(T0 + 30_000, 'at 30 s') });
        page.send({ kind: 'console', entry: consoleEntry(T0 + 75_000, 'at 75 s') });
        page.send({ kind: 'clock', ts: T0 + 90_000 });
        await new Promise((resolve) => setTimeout(resolve, 20));
        page.close();
      },
    });

    const run = await probara(['--cdp', fake.httpUrl]);

    expect(run.exitCode, run.stderr).toBe(0);
    const [vis] = api.vises();
    expect(vis).toMatchObject({ status: 'ready', durationMs: 60_000 });
    expect(lines(vis?.ulid ?? '', 'console').map((entry) => entry.args)).toEqual([['at 30 s']]);
    expect(lines(vis?.ulid ?? '', 'replay')).toHaveLength(2);
  });
});

describe('probara vis record: hostile pages', () => {
  it('drops what it cannot keep, a nesting too deep to serialize included, and finishes the recording', async () => {
    const before = recordDirs();
    const deep = deepJson(100_000);
    const fake = await browser({
      pages: [CHECKOUT],
      onInject: async (page) => {
        page.send({ kind: 'replay', events: [meta(T0), snapshot(T0 + 1)] });
        page.send(
          `{"kind":"replay","events":[{"type":3,"timestamp":${String(T0 + 2)},"data":${deep}}]}`,
        );
        page.send(`{"kind":"environment","environment":{"environment":${deep}}}`);
        const target = JSON.stringify(click(T0 + 3)).replace(
          '"tag":"button"}',
          `"tag":"button","extra":${deep}}`,
        );
        page.send(`{"kind":"events","entry":${target}}`);
        page.send({ kind: 'console', entry: consoleEntry(T0 + 500, 'kept') });
        page.send({ kind: 'environment', environment: ENVIRONMENT });
        page.send({ kind: 'replay', events: [move(T0 + 1000)] });
        await new Promise((resolve) => setTimeout(resolve, 20));
        page.close();
      },
    });

    const run = await probara(['--cdp', fake.httpUrl]);

    expect(run.exitCode, run.stderr).toBe(0);
    const [vis] = api.vises();
    expect(lines(vis?.ulid ?? '', 'replay').map((event) => event.timestamp)).toEqual([
      T0,
      T0 + 1,
      T0 + 1000,
    ]);
    expect(lines(vis?.ulid ?? '', 'console').map((entry) => entry.args)).toEqual([['kept']]);
    // The target keeps only its own fields: the nesting hung off it is gone.
    expect(lines(vis?.ulid ?? '', 'events')).toEqual([{ ...click(T0 + 3), t: 3 }]);
    expect(vis?.environment).toEqual(ENVIRONMENT.environment);
    expect(run.stderr).toContain(
      'Ignored 2 messages from the page that were not valid capture data',
    );
    expect(recordDirs()).toEqual(before);
  });

  it('takes the binding off every frame, iframes included', () => {
    const binding = '__probaraVis0123456789abcdef';
    const top = {};
    const frame: Record<string, unknown> = { top, [binding]: () => undefined };

    runInNewContext(pageScript(binding, { capture: '', replay: '' }), { window: frame });

    expect(Object.keys(frame)).not.toContain(binding);
  });
});

describe('probara vis record: signals during the upload', () => {
  it('a second signal cancels the upload, deletes the pending Vis and removes the temporary files', async () => {
    const before = recordDirs();
    const terminal = signals();
    let stalled = false;
    const fetchWithStall: typeof fetch = (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (/\/parts\/1$/.test(url) && !stalled) {
        stalled = true;
        // The part never arrives: the second Ctrl+C comes while it is in flight.
        setTimeout(() => terminal.send('SIGINT'), 10);
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error);
          });
        });
      }
      return api.fetch(input, init);
    };
    const fake = await browser({
      pages: [CHECKOUT],
      onInject: async (page) => {
        page.send({ kind: 'replay', events: [meta(T0), snapshot(T0 + 1), move(T0 + 2500)] });
        await new Promise((resolve) => setTimeout(resolve, 20));
        terminal.send('SIGINT');
      },
    });

    const run = await runCli(['vis', 'record', '--cdp', fake.httpUrl], {
      env: ENV,
      fetch: fetchWithStall,
      stopSignals: terminal.stopSignals,
    });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('SIGINT: the recording ends');
    expect(run.stderr).toContain(
      'SIGINT again: the upload stops and the pending Vis is deleted; a third one quits at once',
    );
    expect(run.stderr).toContain('Deleted the pending VIS-1: nothing was left behind');
    expect(api.vises()).toEqual([]);
    expect(recordDirs()).toEqual(before);
    // A third signal is the terminal's again: the command no longer listens.
    expect(terminal.listening).toBe(false);
  });

  it('says what was left when the pending Vis cannot be deleted', async () => {
    const terminal = signals();
    let stalled = false;
    api.fail(
      'DELETE',
      /^\/api\/v1\/vises\/[^/]+$/,
      503,
      {
        error: { code: 'internal_error', message: 'down' },
      },
      20,
    );
    const fetchWithStall: typeof fetch = (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (/\/parts\/1$/.test(url) && !stalled) {
        stalled = true;
        setTimeout(() => terminal.send('SIGTERM'), 10);
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error);
          });
        });
      }
      return api.fetch(input, init);
    };
    const fake = await browser({
      pages: [CHECKOUT],
      onInject: async (page) => {
        page.send({ kind: 'replay', events: [meta(T0), snapshot(T0 + 1)] });
        await new Promise((resolve) => setTimeout(resolve, 20));
        page.close();
      },
    });

    const run = await runCli(['vis', 'record', '--cdp', fake.httpUrl], {
      env: ENV,
      fetch: fetchWithStall,
      stopSignals: terminal.stopSignals,
    });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('SIGTERM: the upload stops and the pending Vis is deleted');
    expect(run.stderr).toContain(
      'Could not delete the pending VIS-1 (Probara answered 503 internal_error: down): Probara deletes it seven days after its creation',
    );
  });
});

describe('probara vis record: page URLs', () => {
  const SECRET_PAGE = {
    id: 'PAGE-RESET',
    url: 'https://shop.example.com/reset?token=abc123secret',
    title: 'Reset',
  };

  it('redacts the secrets in the query of the page URL wherever it shows or is sent', async () => {
    const fake = await browser({
      pages: [SECRET_PAGE],
      onInject: async (page) => {
        page.send({
          kind: 'replay',
          events: [{ ...meta(T0), data: { href: SECRET_PAGE.url, width: 1, height: 1 } }],
        });
        page.send({ kind: 'replay', events: [snapshot(T0 + 1)] });
        page.send({
          kind: 'environment',
          environment: { ...ENVIRONMENT, pageUrl: SECRET_PAGE.url },
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        page.close();
      },
    });

    const run = await probara(['--cdp', fake.httpUrl]);

    expect(run.exitCode, run.stderr).toBe(0);
    const [vis] = api.vises();
    expect(run.stderr).toContain('Recording "Reset" (https://shop.example.com/reset?token=');
    expect(run.stderr).not.toContain('abc123secret');
    expect(vis?.pageUrl).toMatch(/^https:\/\/shop\.example\.com\/reset\?token=/);
    expect(vis?.pageUrl).not.toContain('abc123secret');
    expect(JSON.stringify(lines(vis?.ulid ?? '', 'replay'))).not.toContain('abc123secret');
  });

  it('redacts them in the list of pages, and lists only the pages --target matches', async () => {
    const fake = await browser({
      pages: [SECRET_PAGE, CHECKOUT, ADMIN],
      onInject: recordAndClose,
    });

    const unclear = await probara(['--cdp', fake.httpUrl]);
    const several = await probara(['--cdp', fake.httpUrl, '--target', 'shop.example']);

    expect(unclear.exitCode).toBe(2);
    expect(unclear.stderr).toContain(`  ${SECRET_PAGE.id}  https://shop.example.com/reset?token=`);
    expect(unclear.stderr).not.toContain('abc123secret');
    expect(several.exitCode).toBe(2);
    expect(several.stderr).toContain('2 pages match --target "shop.example": pass the id of one');
    expect(several.stderr).toContain(`  ${CHECKOUT.id}  ${CHECKOUT.url}  Checkout`);
    expect(several.stderr).not.toContain(ADMIN.id);
  });
});
