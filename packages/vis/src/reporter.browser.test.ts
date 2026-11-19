/**
 * In-app reporting in a real Chromium page, over the real capture engine and rrweb: a fake widget
 * intake answers the requests, a canvas stream stands in for the shared tab.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { WIDGET_INTAKE_PATH } from './intake.js';
import { metadata } from './metadata.js';
import type { ReplayModule } from './replay-loader.js';
import {
  createReporter,
  createReporterWith,
  type ReporterInternals,
  type ReporterOptions,
  type ReporterState,
} from './reporter.js';

const KEY = 'pvk_eyJ2IjoxfQ.c2lnbmF0dXJl';
const ACME = '01JACME0000000000000000000';
const CONFIG = {
  organizationName: 'Acme',
  recordingMaxMinutes: 15,
  instantReplay: true,
  requireVerifiedReporter: false,
};
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

interface Received {
  method: string;
  path: string;
  body: unknown;
  reporter: string | null;
  organizations: string | null;
}

/** A fake widget intake over fetch: records each request and answers like the server. */
function fakeIntake(
  config: unknown = CONFIG,
  overrides: Partial<Record<string, () => Response | Promise<Response>>> = {},
) {
  const received: Received[] = [];
  const parts: Blob[] = [];
  const assets = new Map<string, Uint8Array>();
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const fetch = (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input);
    expect(url.pathname.startsWith(`${WIDGET_INTAKE_PATH}${KEY}`)).toBe(true);
    const path = url.pathname.slice(WIDGET_INTAKE_PATH.length + KEY.length);
    const method = init.method ?? 'GET';
    let body: unknown = init.body;
    if (typeof init.body === 'string') body = JSON.parse(init.body);
    if (init.body instanceof Blob) parts.push(init.body);
    if (init.body instanceof Uint8Array) assets.set(path.split('/').at(-1) ?? '', init.body);
    const headers = new Headers(init.headers);
    received.push({
      method,
      path,
      body,
      reporter: headers.get('probara-reporter'),
      organizations: headers.get('probara-organizations'),
    });
    const key = `${method} ${path}`;
    const override = Object.entries(overrides).find(([pattern]) => key.endsWith(pattern));
    if (override?.[1] !== undefined) return Promise.resolve(override[1]());
    if (method === 'GET') return Promise.resolve(json(config));
    if (key.endsWith('/submissions'))
      return Promise.resolve(
        json({ visUlid: '01JVIS', submissionToken: 'sub.TOKEN-2', expiresAt: 1 }, 201),
      );
    if (key.endsWith('/uploads'))
      return Promise.resolve(
        json({ uploadUlid: '01JUP', partSize: 8 * 1024 * 1024, maxBytes: 64 * 1024 * 1024 }, 201),
      );
    if (method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(json({}));
  };
  return { fetch, received, parts, assets };
}

async function ungzip(bytes: Uint8Array | Blob): Promise<unknown[]> {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as Uint8Array<ArrayBuffer>]);
  const text = await new Response(
    blob.stream().pipeThrough(new DecompressionStream('gzip')),
  ).text();
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as unknown);
}

/** A 320x180 canvas stream standing in for the shared tab. */
function canvasStream(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  let frame = 0;
  const timer = setInterval(() => {
    frame += 1;
    if (context !== null) {
      context.fillStyle = `hsl(${String((frame * 7) % 360)} 80% 50%)`;
      context.fillRect(0, 0, 320, 180);
    }
  }, 1000 / 30);
  const stream = canvas.captureStream(30);
  cleanups.push(() => {
    clearInterval(timer);
    for (const track of stream.getTracks()) track.stop();
  });
  return stream;
}

function start(
  options: Partial<ReporterOptions> = {},
  internals: Partial<ReporterInternals> = {},
  intake = fakeIntake(),
) {
  const states: ReporterState[] = [];
  let shadow: ShadowRoot | undefined;
  let launcherRoot: ShadowRoot | undefined;
  let loads = 0;
  const reporter = createReporterWith(
    {
      widgetKey: KEY,
      organizations: [ACME],
      locale: 'en',
      onStateChange: (state) => states.push(state),
      ...options,
    },
    {
      fetch: intake.fetch,
      acquireMedia: () => Promise.resolve({ stream: canvasStream(), release: () => undefined }),
      overlayMode: 'open',
      onOverlay: (root) => {
        shadow = root;
      },
      onLauncher: (root) => {
        launcherRoot = root;
      },
      whenIdle: (run) => {
        const timer = setTimeout(run, 0);
        return () => {
          clearTimeout(timer);
        };
      },
      loadReplay: async () => {
        loads += 1;
        const module: ReplayModule = await import('@probara/vis-capture/replay');
        return module;
      },
      ...internals,
    },
  );
  if (reporter === null) throw new Error('the reporter did not start');
  cleanups.push(() => {
    reporter.destroy();
  });
  return {
    reporter,
    states,
    intake,
    loads: () => loads,
    root: () => {
      if (shadow === undefined) throw new Error('no panel');
      return shadow;
    },
    launcher: () => launcherRoot,
  };
}

function button(root: ShadowRoot, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === name && candidate.closest('[hidden]') === null,
  );
  if (found === undefined) throw new Error(`no visible button "${name}"`);
  return found;
}

const visibleButtons = (root: ShadowRoot): string[] =>
  [...root.querySelectorAll('button')]
    .filter((candidate) => candidate.closest('[hidden]') === null)
    .map((candidate) => candidate.textContent);

function mount(html: string): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.append(element);
  cleanups.push(() => {
    element.remove();
  });
  return element;
}

describe('createReporter', () => {
  it('refuses invalid options with one console warning and never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const invalid: unknown[] = [
      undefined,
      {},
      { widgetKey: KEY },
      { widgetKey: KEY, organizations: [] },
      { widgetKey: KEY, organizations: ['nope'] },
      { widgetKey: 'pvs_secret.sig', organizations: [ACME] },
      { widgetKey: 'not a key', organizations: [ACME] },
      { widgetKey: KEY, organizations: [ACME], apiOrigin: 'javascript:alert(1)' },
    ];
    for (const options of invalid) {
      expect(createReporter(options as ReporterOptions)).toBeNull();
    }
    expect(warn).toHaveBeenCalledTimes(invalid.length);
    expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
  });

  it('keeps one reporter per page: a second call gives the same one until it is destroyed', () => {
    const { reporter } = start();
    expect(createReporter({ widgetKey: KEY, organizations: [ACME] })).toBe(reporter);
    reporter.destroy();
    expect(reporter.state).toBe('closed');
    const next = createReporter({ widgetKey: KEY, organizations: [ACME] });
    expect(next).not.toBe(reporter);
    next?.destroy();
  });
});

describe('the widget configuration', () => {
  it('is read once and kept in sessionStorage for five minutes per key', async () => {
    const first = start();
    await vi.waitFor(() => {
      expect(first.loads()).toBe(1);
    });
    expect(first.intake.received).toHaveLength(1);
    expect(first.intake.received[0]).toMatchObject({
      method: 'GET',
      path: '',
      organizations: ACME,
    });
    first.reporter.destroy();

    const second = start();
    await vi.waitFor(() => {
      expect(second.loads()).toBe(1);
    });
    expect(second.intake.received).toEqual([]);
    second.reporter.destroy();

    // Older than five minutes: read again.
    const stored = JSON.parse(sessionStorage.getItem(`probara-vis-widget:${KEY}`) ?? '{}') as {
      at: number;
    };
    sessionStorage.setItem(
      `probara-vis-widget:${KEY}`,
      JSON.stringify({ ...stored, at: Date.now() - 5 * 60_000 - 1 }),
    );
    const third = start();
    await vi.waitFor(() => {
      expect(third.intake.received).toHaveLength(1);
    });
  });

  it('with instant replay off never loads the replay, and offers recording only', async () => {
    const t = start({}, {}, fakeIntake({ ...CONFIG, instantReplay: false }));
    await vi.waitFor(() => {
      expect(t.intake.received).toHaveLength(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(t.loads()).toBe(0);
    t.reporter.open();
    expect(t.reporter.state).toBe('choosing');
    expect(visibleButtons(t.root())).toEqual(['Record from the start', 'Close']);
    button(t.root(), 'Close').click();
    expect(t.reporter.state).toBe('idle');
    expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
  });
});

describe('send what just happened', () => {
  it('buffers before the click, uploads nothing until sent, then sends the replay and diagnostics', async () => {
    const page = mount(
      '<p id="card">card-4111-secret</p><p class="email">mail-secret</p><p>visible-text</p>',
    );
    const t = start({
      blur: ['.email'],
      reporterToken: () => 'reporter.jwt.sig',
      logSanitizer: (entry) => (entry.args[0] === 'drop me' ? null : entry),
    });
    await vi.waitFor(() => {
      expect(t.loads()).toBe(1);
    });
    page.querySelector('#card')?.setAttribute('data-probara-blur', '');
    // The page looks the same: buffering blurs nothing on screen.
    expect(getComputedStyle(page.querySelector('.email') as Element).filter).toBe('none');
    await userEvent.click(page.querySelector('p:last-child') as HTMLElement);
    console.error('checkout exploded');
    console.log('drop me');
    await fetch('/__probara_missing__').catch(() => undefined);
    page.append(Object.assign(document.createElement('p'), { textContent: 'after-click-text' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Only the configuration was read so far.
    expect(t.intake.received.map((request) => request.method)).toEqual(['GET']);

    t.reporter.open();
    expect(visibleButtons(t.root())).toEqual([
      'Send what just happened',
      'Record from the start',
      'Close',
    ]);
    button(t.root(), 'Send what just happened').click();
    expect(t.reporter.state).toBe('replay-review');
    const text = t.root().textContent;
    expect(text).toContain('Covers the last 0:');
    expect(text).toContain(`Page: ${location.host}${location.pathname}`);
    // Counts of errors would alarm a visitor for nothing: they reach Probara, not the panel.
    expect(text).not.toContain('Console errors');
    expect(text).not.toContain('Failed requests');
    const field = t.root().querySelector('textarea') as HTMLTextAreaElement;
    field.value = 'The total was wrong';
    button(t.root(), 'Send').click();
    await vi.waitFor(() => {
      expect(t.reporter.state).toBe('done');
    });
    expect(t.root().textContent).toContain('Thank you! Your report was sent.');

    const requests = t.intake.received.map((request) => `${request.method} ${request.path}`);
    expect(requests).toEqual([
      'GET ',
      'POST /submissions',
      'POST /submissions/sub.TOKEN-2/uploads',
      'PUT /submissions/sub.TOKEN-2/uploads/01JUP/parts/1',
      'POST /submissions/sub.TOKEN-2/uploads/01JUP/complete',
      'PUT /submissions/sub.TOKEN-2/assets/console',
      'PUT /submissions/sub.TOKEN-2/assets/network',
      'PUT /submissions/sub.TOKEN-2/assets/events',
      'POST /submissions/sub.TOKEN-2/finalize',
    ]);
    expect(t.intake.received.map((request) => request.reporter)).toEqual([
      null,
      'reporter.jwt.sig',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    const startBody = t.intake.received[1]?.body as Record<string, unknown>;
    expect(startBody).toMatchObject({ kind: 'replay', description: 'The total was wrong' });
    // The page's address, its secrets redacted as in every Vis.
    expect(String(startBody['pageUrl'])).toMatch(
      new RegExp(`^${location.origin}${location.pathname}`),
    );
    expect(typeof startBody['capturedAt']).toBe('number');
    expect(t.intake.received[2]?.body).toEqual({
      kind: 'replay',
      contentType: 'application/x-ndjson',
      contentEncoding: 'gzip',
    });
    const finalize = t.intake.received.at(-1)?.body as { durationMs: number };
    expect(finalize.durationMs).toBeGreaterThan(0);

    const replay = (await ungzip(t.intake.parts[0] as Blob)) as { type: number }[];
    // rrweb's full snapshot is event type 2.
    expect(replay.some((event) => event.type === 2)).toBe(true);
    const replayJson = JSON.stringify(replay);
    expect(replayJson).toContain('visible-text');
    expect(replayJson).not.toContain('mail-secret');
    // What the panel did is not part of what just happened.
    expect(replayJson).not.toContain('Send what just happened');
    const consoleEntries = JSON.stringify(
      await ungzip(t.intake.assets.get('console') as Uint8Array),
    );
    expect(consoleEntries).toContain('checkout exploded');
    expect(consoleEntries).not.toContain('drop me');
    expect(JSON.stringify(await ungzip(t.intake.assets.get('network') as Uint8Array))).toContain(
      '__probara_missing__',
    );

    button(t.root(), 'Close').click();
    expect(t.reporter.state).toBe('idle');
    expect(t.states).toEqual(['choosing', 'replay-review', 'sending', 'done', 'idle']);
  });

  it('opens the review at once with open("instant-replay"), and discard sends nothing', async () => {
    const t = start();
    await vi.waitFor(() => {
      expect(t.loads()).toBe(1);
    });
    console.error('the discarded moment');
    t.reporter.open('instant-replay');
    expect(t.reporter.state).toBe('replay-review');
    button(t.root(), 'Discard').click();
    const confirm = [...t.root().querySelectorAll('.confirm button')].find(
      (candidate) => candidate.textContent === 'Discard',
    ) as HTMLButtonElement;
    confirm.click();
    expect(t.reporter.state).toBe('idle');
    expect(t.intake.received.map((request) => request.method)).toEqual(['GET']);
    // Buffering starts over: what was discarded is not sent with the next report.
    console.error('after the discard');
    t.reporter.open('instant-replay');
    expect(t.reporter.state).toBe('replay-review');
    button(t.root(), 'Send').click();
    await vi.waitFor(() => {
      expect(t.reporter.state).toBe('done');
    });
    const sent = JSON.stringify(await ungzip(t.intake.assets.get('console') as Uint8Array));
    expect(sent).toContain('after the discard');
    expect(sent).not.toContain('the discarded moment');
  });

  it('tells the reporter when the widget requires a verified reporter', async () => {
    const t = start(
      {},
      {},
      fakeIntake(CONFIG, {
        'POST /submissions': () =>
          new Response(JSON.stringify({ error: { code: 'reporter_required' } }), { status: 401 }),
      }),
    );
    await vi.waitFor(() => {
      expect(t.loads()).toBe(1);
    });
    t.reporter.open('instant-replay');
    button(t.root(), 'Send').click();
    await vi.waitFor(() => {
      expect(t.reporter.state).toBe('unavailable');
    });
    expect(t.root().querySelector('.message')?.textContent).toBe('Sign in to report a problem.');
    expect(t.intake.received.map((request) => request.method)).toEqual(['GET', 'POST']);
  });
});

describe('record from the start', () => {
  it('records through the widget intake as a video', async () => {
    const t = start({ title: 'From the app', reporterToken: () => 'record.jwt.sig' });
    t.reporter.open('record');
    await vi.waitFor(() => {
      expect(t.reporter.state).toBe('ready');
    });
    button(t.root(), 'Start recording').click();
    await vi.waitFor(() => {
      expect(t.reporter.state).toBe('recording');
    });
    const startBody = t.intake.received.find((request) => request.path === '/submissions')?.body;
    expect(startBody).toMatchObject({ kind: 'video', title: 'From the app' });
    expect(t.intake.received.find((request) => request.path === '/submissions')?.reporter).toBe(
      'record.jwt.sig',
    );
    expect(t.intake.received.find((request) => request.path.endsWith('/uploads'))?.body).toEqual({
      kind: 'video',
      contentType: expect.stringMatching(/^video\//) as string,
    });
    button(t.root(), 'Discard').click();
    await vi.waitFor(() => {
      expect(t.reporter.state).toBe('ready');
    });
    button(t.root(), 'Close').click();
    expect(t.reporter.state).toBe('idle');
  });

  it('never sends a folder: the widget key sets it in Probara', async () => {
    // A folder can only arrive from plain JavaScript: the type has no such option.
    const t = start({
      folder: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    } as unknown as Partial<ReporterOptions>);
    t.reporter.open('record');
    await vi.waitFor(() => {
      expect(t.reporter.state).toBe('ready');
    });
    button(t.root(), 'Start recording').click();
    await vi.waitFor(() => {
      expect(t.reporter.state).toBe('recording');
    });
    const startBody = t.intake.received.find((request) => request.path === '/submissions')?.body;
    expect(startBody).toMatchObject({ kind: 'video' });
    expect(startBody).not.toHaveProperty('folderUlid');
    button(t.root(), 'Discard').click();
    await vi.waitFor(() => {
      expect(t.reporter.state).toBe('ready');
    });
  });
});

describe('the launcher', () => {
  it('opens the panel from a labelled button coloured by the page', async () => {
    document.documentElement.style.setProperty('--probara-vis-accent', 'rgb(10, 20, 30)');
    document.documentElement.style.setProperty(
      '--probara-vis-accent-contrast',
      'rgb(250, 240, 230)',
    );
    cleanups.push(() => {
      document.documentElement.style.removeProperty('--probara-vis-accent');
      document.documentElement.style.removeProperty('--probara-vis-accent-contrast');
    });
    const t = start({ launcher: { position: 'bottom-left', label: 'Help us fix it' } });
    await vi.waitFor(() => {
      expect(t.loads()).toBe(1);
    });
    const launcher = t.launcher()?.querySelector('button');
    expect(launcher?.textContent).toBe('Help us fix it');
    expect(launcher?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(launcher?.type).toBe('button');
    expect(launcher?.closest('[hidden]')).toBeNull();
    const style = getComputedStyle(launcher as Element);
    expect([style.backgroundColor, style.color]).toEqual(['rgb(10, 20, 30)', 'rgb(250, 240, 230)']);
    const host = (t.launcher() as ShadowRoot).host as HTMLElement;
    expect([host.style.getPropertyValue('left'), host.style.getPropertyValue('bottom')]).toEqual([
      '16px',
      '16px',
    ]);
    launcher?.click();
    expect(t.reporter.state).toBe('choosing');
    expect(host.hidden).toBe(true);
    button(t.root(), 'Close').click();
    expect(host.hidden).toBe(false);
  });

  it('defaults to "Report a problem", the panel\'s card colours, bottom right', async () => {
    const t = start({ launcher: true, locale: 'es' });
    await vi.waitFor(() => {
      expect(t.loads()).toBe(1);
    });
    const launcher = t.launcher()?.querySelector('button');
    expect(launcher?.textContent).toBe('Reportar un problema');
    const style = getComputedStyle(launcher as Element);
    expect([style.backgroundColor, style.color]).toEqual(['rgb(253, 252, 254)', 'rgb(31, 30, 37)']);
    expect(((t.launcher() as ShadowRoot).host as HTMLElement).style.getPropertyValue('right')).toBe(
      '16px',
    );
  });

  it('is hidden when the browser cannot record and there is no instant replay', async () => {
    const t = start(
      { launcher: true },
      { recordingSupported: () => false },
      fakeIntake({ ...CONFIG, instantReplay: false }),
    );
    await vi.waitFor(() => {
      expect(t.intake.received).toHaveLength(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(((t.launcher() as ShadowRoot).host as HTMLElement).hidden).toBe(true);
  });
});

/** What the captures replace, to compare by identity; never called. */
function pageApis(): Record<string, unknown> {
  /* eslint-disable @typescript-eslint/unbound-method -- compared by identity, never called */
  return {
    fetch: window.fetch,
    open: XMLHttpRequest.prototype.open,
    send: XMLHttpRequest.prototype.send,
    error: console.error,
    log: console.log,
    WebSocket: window.WebSocket,
  };
  /* eslint-enable @typescript-eslint/unbound-method */
}

describe('destroy', () => {
  it('stops every capture and puts the page back as it was', async () => {
    const before = pageApis();
    const t = start({ launcher: true });
    await vi.waitFor(() => {
      expect(t.loads()).toBe(1);
    });
    expect(pageApis()['fetch']).not.toBe(before['fetch']);
    t.reporter.open();
    t.reporter.destroy();
    expect(t.reporter.state).toBe('closed');
    expect(pageApis()).toEqual(before);
    expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
    expect(document.querySelector('[data-probara-vis-launcher]')).toBeNull();
    t.reporter.open();
    expect(t.reporter.state).toBe('closed');
  });
});

describe('the reporter around a report', () => {
  it('buffers again, wrapping the page once, after a recording is closed', async () => {
    const before = pageApis();
    const t = start();
    await vi.waitFor(() => {
      expect(t.loads()).toBe(1);
    });
    t.reporter.open('record');
    await vi.waitFor(() => {
      expect(t.reporter.state).toBe('ready');
    });
    button(t.root(), 'Start recording').click();
    await vi.waitFor(() => {
      expect(t.reporter.state).toBe('recording');
    });
    t.reporter.close();
    expect(t.reporter.state).toBe('idle');
    await new Promise((resolve) => setTimeout(resolve, 20));
    console.error('after the recording');
    t.reporter.open('instant-replay');
    expect(t.reporter.state).toBe('replay-review');
    button(t.root(), 'Send').click();
    await vi.waitFor(() => {
      expect(t.reporter.state).toBe('done');
    });
    expect(JSON.stringify(await ungzip(t.intake.assets.get('console') as Uint8Array))).toContain(
      'after the recording',
    );
    t.reporter.destroy();
    expect(pageApis()).toEqual(before);
  });

  it('keeps buffering when the review is closed: the next open shows what happened since, as the first did', async () => {
    const t = start();
    await vi.waitFor(() => {
      expect(t.loads()).toBe(1);
    });
    console.error('before the review');
    t.reporter.open('instant-replay');
    expect(t.reporter.state).toBe('replay-review');
    (t.root().querySelector('textarea') as HTMLTextAreaElement).value = 'The total was wrong';
    button(t.root(), 'Close').click();
    expect(t.reporter.state).toBe('idle');
    expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
    const closedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 20));
    console.error('after it was closed');
    t.reporter.open();
    expect(t.reporter.state).toBe('choosing');
    button(t.root(), 'Send what just happened').click();
    expect(t.reporter.state).toBe('replay-review');
    expect((t.root().querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
    button(t.root(), 'Send').click();
    await vi.waitFor(() => {
      expect(t.reporter.state).toBe('done');
    });
    const startBody = t.intake.received[1]?.body as { capturedAt: number; description?: string };
    expect(startBody.capturedAt).toBeGreaterThan(closedAt);
    expect(startBody.description).toBeUndefined();
    const sent = JSON.stringify(await ungzip(t.intake.assets.get('console') as Uint8Array));
    expect(sent).toContain('before the review');
    expect(sent).toContain('after it was closed');
  });

  it('sends the metadata of the moment the replay was taken, and aborts a report closed while sent', async () => {
    const unregister = metadata(() => ({ plan: 'pro' }));
    cleanups.push(unregister);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = start(
      {},
      {},
      fakeIntake(CONFIG, {
        'POST /submissions/sub.TOKEN-2/uploads': async () => {
          await held;
          return new Response(
            JSON.stringify({ uploadUlid: '01JUP', partSize: 8 * 1024 * 1024, maxBytes: 1 << 26 }),
            { status: 201 },
          );
        },
      }),
    );
    await vi.waitFor(() => {
      expect(t.loads()).toBe(1);
    });
    t.reporter.open('instant-replay');
    button(t.root(), 'Send').click();
    await vi.waitFor(() => {
      expect(t.intake.received.some((request) => request.path.endsWith('/uploads'))).toBe(true);
    });
    t.reporter.close();
    release();
    expect(t.reporter.state).toBe('idle');
    await vi.waitFor(() => {
      expect(t.intake.received.map((request) => `${request.method} ${request.path}`)).toContain(
        'DELETE /submissions/sub.TOKEN-2',
      );
    });
    expect(t.intake.received[1]?.body).toMatchObject({ kind: 'replay', metadata: { plan: 'pro' } });
    expect(
      t.intake.received.some(
        (request) => request.path.endsWith('/finalize') || request.path.includes('/parts/'),
      ),
    ).toBe(false);
  });

  it('keeps the rolling replay within its mutation limit', async () => {
    const asked: unknown[] = [];
    const t = start(
      {},
      {
        loadReplay: async () => {
          const module: ReplayModule = await import('@probara/vis-capture/replay');
          return {
            ...module,
            createReplayRecorder: (options) => {
              asked.push(options);
              return module.createReplayRecorder(options);
            },
          };
        },
      },
    );
    await vi.waitFor(() => {
      expect(asked).toHaveLength(1);
    });
    expect(asked[0]).toMatchObject({ mode: 'rolling', mutationLimit: 10_000 });
    t.reporter.destroy();
  });
});
