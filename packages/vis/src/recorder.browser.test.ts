/**
 * The in-page recorder in a real Chromium page, over the real capture engine: a canvas stream
 * stands in for the shared tab and a fake intake answers the requests.
 */
import { BLUR_ATTRIBUTE, REDACTED, SANITIZER_REDACTED } from '@probara/vis-capture';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecorderState } from './controller.js';
import { INTAKE_PATH } from './intake.js';
import {
  isRecordingSupported,
  startRecorderFromUrlWith,
  startRecorderWith,
  type Recorder,
  type RecorderInternals,
  type RecorderOptions,
} from './recorder.js';

const TOKEN = 'link.TOKEN_secret-1';
const ACME = '01JACME0000000000000000000';
const BETA = '01JBETA0000000000000000000';
const ORGANIZATIONS = [ACME, BETA];
const startUrl = location.href;
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  history.replaceState(history.state, '', startUrl);
  vi.unstubAllGlobals();
});

interface Received {
  /** The origin the request went to. */
  origin: string;
  method: string;
  path: string;
  body: unknown;
  keepalive: boolean;
  credentials: RequestCredentials | undefined;
  referrerPolicy: ReferrerPolicy | undefined;
  /** The `probara-organizations` header. */
  organizations: string | null;
}

/** A fake intake over fetch: records each request and answers like the server. */
function fakeIntake(overrides: Partial<Record<string, () => Response>> = {}) {
  const received: Received[] = [];
  const parts: Blob[] = [];
  const assets = new Map<string, Uint8Array>();
  const answer = (input: string, init: RequestInit): Response => {
    const url = new URL(input);
    expect(url.pathname.startsWith(INTAKE_PATH)).toBe(true);
    const path = url.pathname.slice(INTAKE_PATH.length) + url.search;
    const method = init.method ?? 'GET';
    let body: unknown = init.body;
    if (typeof init.body === 'string') body = JSON.parse(init.body);
    if (init.body instanceof Blob) parts.push(init.body);
    if (init.body instanceof Uint8Array) assets.set(path.split('/').at(-1) ?? '', init.body);
    received.push({
      origin: url.origin,
      method,
      path,
      body,
      keepalive: init.keepalive === true,
      credentials: init.credentials,
      referrerPolicy: init.referrerPolicy,
      organizations: new Headers(init.headers).get('probara-organizations'),
    });
    const key = `${method} ${path.replace(/\?.*/, '')}`;
    const override = Object.entries(overrides).find(([pattern]) => key.endsWith(pattern));
    if (override?.[1] !== undefined) return override[1]();
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (method === 'GET')
      return json({
        organizationName: 'Acme',
        title: 'Checkout bug',
        reference: null,
        folder: null,
        microphone: false,
        recordingMaxMinutes: 30,
        expiresAt: null,
      });
    if (key.endsWith('/submissions'))
      return json({ visUlid: '01JVIS', submissionToken: 'sub.TOKEN-2', expiresAt: 1 }, 201);
    if (key.endsWith('/uploads'))
      return json(
        { uploadUlid: '01JUP', partSize: 8 * 1024 * 1024, maxBytes: 64 * 1024 * 1024 },
        201,
      );
    if (method === 'DELETE') return new Response(null, { status: 204 });
    if (key.endsWith('/finalize')) return json({ visUlid: '01JVIS', status: 'ready' });
    return json({});
  };
  const fetch = (input: string, init: RequestInit): Promise<Response> =>
    Promise.resolve(answer(input, init));
  return { fetch, received, parts, assets };
}

/** A 320x180 stream of a canvas that changes every frame, released by the test's cleanup. */
function canvasStream(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('no 2d context');
  let frame = 0;
  const timer = setInterval(() => {
    frame += 1;
    context.fillStyle = `hsl(${(frame * 7) % 360} 80% 50%)`;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }, 1000 / 30);
  const stream = canvas.captureStream(30);
  cleanups.push(() => {
    clearInterval(timer);
    for (const track of stream.getTracks()) track.stop();
  });
  return stream;
}

async function ungzip(bytes: Uint8Array): Promise<unknown[]> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const text = await new Response(stream).text();
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as unknown);
}

function start(
  options: Partial<RecorderOptions> = {},
  internals: Partial<RecorderInternals> = {},
): {
  recorder: Recorder;
  states: RecorderState[];
  intake: ReturnType<typeof fakeIntake>;
  root: () => ShadowRoot;
} {
  const intake = fakeIntake();
  const states: RecorderState[] = [];
  let shadow: ShadowRoot | undefined;
  const recorder = startRecorderWith(
    TOKEN,
    {
      organizations: ORGANIZATIONS,
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
      ...internals,
    },
  );
  if (recorder === null) throw new Error('the recorder did not start');
  cleanups.push(() => {
    recorder.close();
  });
  return {
    recorder,
    states,
    intake,
    root: () => {
      if (shadow === undefined) throw new Error('no overlay');
      return shadow;
    },
  };
}

function button(root: ShadowRoot, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === name && !candidate.hidden,
  );
  if (found === undefined) throw new Error(`no visible button "${name}"`);
  return found;
}

describe('the in-page recorder', () => {
  it('records the tab with the console, network and user events, and sends a Vis', async () => {
    const { recorder, states, intake, root } = start({
      logSanitizer: (entry) => (entry.args[0] === 'drop me' ? null : entry),
      locale: 'en',
    });
    await vi.waitFor(() => {
      expect(recorder.state).toBe('ready');
    });
    expect(root().textContent).toContain('Ready to record?');
    // The title comes from the link: the visitor never edits it.
    expect(root().querySelector('input')).toBeNull();

    button(root(), 'Start recording').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('recording');
    }, 5000);

    const pageButton = document.createElement('button');
    pageButton.textContent = 'Pay now';
    document.body.append(pageButton);
    cleanups.push(() => {
      pageButton.remove();
    });
    pageButton.click();
    console.log('hello from the page', 'token=abc123secret');
    console.log('drop me');
    await fetch(`${location.origin}/__probara_vis_test__?password=hunter2`).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 600));

    button(root(), 'Stop').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('review');
    }, 10_000);
    // The visitor watches the recording in the page; nothing is final until Send.
    const player = root().querySelector('video');
    expect(player?.hidden).toBe(false);
    expect(player?.src.startsWith('blob:')).toBe(true);
    expect(root().textContent).toContain('Ready to send?');
    expect(intake.received.some((request) => request.path.endsWith('/finalize'))).toBe(false);
    expect(intake.received.some((request) => request.path.endsWith('/complete'))).toBe(false);

    button(root(), 'Send').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('done');
    }, 10_000);
    expect(states).toEqual([
      'loading',
      'ready',
      'starting',
      'recording',
      'review',
      'sending',
      'done',
    ]);
    expect(root().querySelector('video')?.hidden).toBe(true);

    const paths = intake.received.map(
      (request) => `${request.method} ${request.path.split('?')[0] ?? ''}`,
    );
    expect(paths[0]).toBe(`GET ${TOKEN}`);
    expect(paths).toContain(`POST ${TOKEN}/submissions`);
    expect(paths.at(-1)).toBe(`POST ${TOKEN}/submissions/sub.TOKEN-2/finalize`);
    for (const request of intake.received) {
      expect(request.credentials).toBe('omit');
      expect(request.referrerPolicy).toBe('no-referrer');
      expect(request.organizations).toBe(`${ACME},${BETA}`);
    }
    const started = intake.received.find((request) => request.path.endsWith('/submissions'));
    expect(started?.body).toMatchObject({
      title: 'Checkout bug',
      environment: expect.any(Object) as object,
    });
    expect(JSON.stringify(started?.body)).not.toContain(TOKEN);

    expect(intake.parts.length).toBeGreaterThan(0);
    const finalize = intake.received.at(-1)?.body as { durationMs: number };
    expect(finalize.durationMs).toBeGreaterThan(0);
    expect(finalize.durationMs).toBeLessThanOrEqual(30 * 60_000);

    const consoleLines = await ungzip(intake.assets.get('console') ?? new Uint8Array());
    expect(consoleLines).toEqual([
      expect.objectContaining({ level: 'log', args: ['hello from the page', `token=${REDACTED}`] }),
    ]);
    const network = JSON.stringify(await ungzip(intake.assets.get('network') ?? new Uint8Array()));
    expect(network).toContain('__probara_vis_test__');
    expect(network).not.toContain('hunter2');
    expect(network).not.toContain(INTAKE_PATH);
    const events = (await ungzip(intake.assets.get('events') ?? new Uint8Array())) as {
      type: string;
      target?: { text?: string };
    }[];
    const clicks = events.filter((event) => event.type === 'click');
    // The page's click is there; the overlay's own clicks (record, stop) are not.
    expect(clicks.map((click) => click.target?.text)).toEqual(['Pay now']);
  }, 20_000);

  it('takes the token out of the address bar, keeping the rest', () => {
    history.replaceState(history.state, '', `${startUrl}&probara-recording=${TOKEN}#here`);
    const intake = fakeIntake();
    const recorder = startRecorderFromUrlWith(
      { organizations: ORGANIZATIONS },
      { fetch: intake.fetch, overlayMode: 'open' },
    );
    cleanups.push(() => recorder?.close());
    expect(recorder).not.toBeNull();
    expect(location.href).toBe(`${startUrl}#here`);
    expect(location.href).not.toContain(TOKEN);
  });

  it('starts nothing for a page without a token', () => {
    expect(
      startRecorderFromUrlWith({ organizations: ORGANIZATIONS }, { fetch: fakeIntake().fetch }),
    ).toBeNull();
    expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
  });

  it('isolates the overlay in a closed shadow root by default', async () => {
    const intake = fakeIntake();
    const recorder = startRecorderWith(
      TOKEN,
      { organizations: ORGANIZATIONS },
      { fetch: intake.fetch },
    );
    cleanups.push(() => recorder?.close());
    const host = document.querySelector('[data-probara-vis-recorder]');
    expect(host).not.toBeNull();
    expect(host?.shadowRoot).toBeNull();
    expect(host?.childElementCount).toBe(0);
    recorder?.close();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
    });
  });

  it('blurs the selectors it is given while recording, elements added later included', async () => {
    const { recorder, root } = start({ blur: ['.customer-email'] });
    await vi.waitFor(() => {
      expect(recorder.state).toBe('ready');
    });
    button(root(), 'Start recording').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('recording');
    }, 5000);
    const later = document.createElement('p');
    later.className = 'customer-email';
    later.textContent = 'jane@example.com';
    const marked = document.createElement('p');
    marked.setAttribute(BLUR_ATTRIBUTE, '');
    const other = document.createElement('p');
    other.setAttribute('data-sentry-block', '');
    document.body.append(later, marked, other);
    cleanups.push(() => {
      later.remove();
      marked.remove();
      other.remove();
    });
    for (const element of [later, marked, other]) {
      expect(getComputedStyle(element).filter).toContain('blur');
    }
    button(root(), 'Discard').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('ready');
    });
    expect(getComputedStyle(later).filter).toBe('none');
  }, 15_000);

  it('applies the selectors of a probara:blur meta tag', async () => {
    const meta = document.createElement('meta');
    meta.name = 'probara:blur';
    meta.content = '.from-meta, #also-meta';
    document.head.append(meta);
    const element = document.createElement('p');
    element.className = 'from-meta';
    document.body.append(element);
    cleanups.push(() => {
      meta.remove();
      element.remove();
    });
    const { recorder, root } = start();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('ready');
    });
    button(root(), 'Start recording').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('recording');
    }, 5000);
    expect(getComputedStyle(element).filter).toContain('blur');
  }, 15_000);

  it('discards: the submission is aborted and nothing is finalized', async () => {
    const { recorder, intake, root } = start();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('ready');
    });
    button(root(), 'Start recording').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('recording');
    }, 5000);
    button(root(), 'Discard').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('ready');
    });
    await vi.waitFor(() => {
      expect(intake.received.at(-1)).toMatchObject({ method: 'DELETE', keepalive: false });
    });
    expect(intake.received.some((request) => request.path.endsWith('/finalize'))).toBe(false);
  }, 15_000);

  it('aborts with a request that outlives the page when the page goes away', async () => {
    const { recorder, intake, root } = start();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('ready');
    });
    button(root(), 'Start recording').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('recording');
    }, 5000);
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    await vi.waitFor(() => {
      expect(intake.received.at(-1)).toMatchObject({
        method: 'DELETE',
        path: `${TOKEN}/submissions/sub.TOKEN-2`,
        keepalive: true,
      });
    });
    expect(recorder.state).toBe('closed');
    expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
  }, 15_000);

  it('shows one message for a link that is not available', async () => {
    const intake = fakeIntake({
      [`GET ${TOKEN}`]: () =>
        new Response(JSON.stringify({ error: { code: 'not_found' } }), { status: 404 }),
    });
    const { recorder, root } = start({ locale: 'es' }, { fetch: intake.fetch });
    await vi.waitFor(() => {
      expect(recorder.state).toBe('unavailable');
    });
    expect(root().textContent).toContain('Este enlace de grabación no está disponible.');
  });

  it('keeps its own requests out of the page: no cookie, no referrer, through the page fetch as it was', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', (_input: string, init: RequestInit) => {
      calls.push(init);
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'not_found' } }), { status: 404 }),
      );
    });
    const recorder = startRecorderWith(
      TOKEN,
      { organizations: ORGANIZATIONS, apiOrigin: location.origin },
      { overlayMode: 'open' },
    );
    cleanups.push(() => recorder?.close());
    await vi.waitFor(() => {
      expect(recorder?.state).toBe('unavailable');
    });
    expect(calls).toEqual([
      expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }),
    ]);
  });

  it('says the browser cannot record the screen, starting nothing, and closes', async () => {
    vi.stubGlobal('MediaRecorder', undefined);
    expect(isRecordingSupported()).toBe(false);
    history.replaceState(history.state, '', `${startUrl}&probara-recording=${TOKEN}`);
    const intake = fakeIntake();
    const states: RecorderState[] = [];
    let shadow: ShadowRoot | undefined;
    const recorder = startRecorderFromUrlWith(
      {
        organizations: ORGANIZATIONS,
        locale: 'en',
        onStateChange: (state) => states.push(state),
      },
      {
        fetch: intake.fetch,
        overlayMode: 'open',
        onOverlay: (root) => {
          shadow = root;
        },
      },
    );
    cleanups.push(() => recorder?.close());
    expect(location.href).toBe(startUrl);
    expect(recorder?.state).toBe('unsupported');
    expect(shadow?.textContent).toContain('This browser cannot record the screen.');
    expect(intake.received).toEqual([]);
    if (shadow === undefined) throw new Error('no overlay');
    button(shadow, 'Close').click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
    });
    expect(recorder?.state).toBe('closed');
    expect(states).toEqual(['unsupported', 'closed']);
    expect(intake.received).toEqual([]);
  });

  it('shows an error with a way out when the link never answers', async () => {
    const intake = fakeIntake();
    const fetch = (input: string, init: RequestInit): Promise<Response> =>
      (init.method ?? 'GET') === 'GET' ? new Promise(() => undefined) : intake.fetch(input, init);
    const { recorder, root } = start({ locale: 'en' }, { fetch, timeoutMs: 50 });
    expect(recorder.state).toBe('loading');
    await vi.waitFor(() => {
      expect(recorder.state).toBe('failed');
    });
    button(root(), 'Close').click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
    });
  });

  it('aborts and shows an error with a way out when the finalize never answers', async () => {
    const intake = fakeIntake();
    const fetch = (input: string, init: RequestInit): Promise<Response> =>
      input.endsWith('/finalize') ? new Promise(() => undefined) : intake.fetch(input, init);
    const { recorder, root } = start({ locale: 'en' }, { fetch, timeoutMs: 200 });
    await vi.waitFor(() => {
      expect(recorder.state).toBe('ready');
    });
    button(root(), 'Start recording').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('recording');
    }, 5000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    button(root(), 'Stop').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('review');
    }, 10_000);
    button(root(), 'Send').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('failed');
    }, 10_000);
    await vi.waitFor(() => {
      expect(intake.received.at(-1)).toMatchObject({
        method: 'DELETE',
        path: `${TOKEN}/submissions/sub.TOKEN-2`,
      });
    });
    expect(root().textContent).toContain('Your recording could not be sent.');
    button(root(), 'Close').click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
    });
  }, 20_000);

  it('refuses a malformed token or API origin without throwing', () => {
    expect(
      startRecorderWith(
        'has space',
        { organizations: ORGANIZATIONS },
        { fetch: fakeIntake().fetch },
      ),
    ).toBeNull();
    expect(
      startRecorderWith(
        TOKEN,
        { organizations: ORGANIZATIONS, apiOrigin: 'javascript:alert(1)' },
        {},
      ),
    ).toBeNull();
    expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
  });

  it('answers a failed sanitizer with the redaction, never the original', async () => {
    const { recorder, intake, root } = start({
      logSanitizer: () => {
        throw new Error('broken sanitizer');
      },
    });
    await vi.waitFor(() => {
      expect(recorder.state).toBe('ready');
    });
    button(root(), 'Start recording').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('recording');
    }, 5000);
    console.log('card 4111 1111 1111 1111 private note');
    await new Promise((resolve) => setTimeout(resolve, 300));
    button(root(), 'Stop').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('review');
    }, 10_000);
    button(root(), 'Send').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('done');
    }, 10_000);
    const lines = JSON.stringify(await ungzip(intake.assets.get('console') ?? new Uint8Array()));
    expect(lines).toContain(SANITIZER_REDACTED);
    expect(lines).not.toContain('private note');
  }, 20_000);
});

describe('the organizations the page serves', () => {
  const warnings = () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    cleanups.push(() => {
      spy.mockRestore();
    });
    return spy;
  };
  const MISSING = /"organizations" option \(data-organizations on the script tag\)/;

  it('starts nothing, sends nothing and warns once for each call without valid organizations', () => {
    const warn = warnings();
    const intake = fakeIntake();
    const refused: unknown[] = [
      undefined,
      [],
      ['not-a-ulid'],
      [ACME, '01JACME000000000000000000O'],
      Array.from({ length: 21 }, (_, index) => `01JACME${String(index).padStart(19, '0')}`),
      ACME,
    ];
    for (const organizations of refused) {
      const options = { organizations } as unknown as RecorderOptions;
      expect(startRecorderWith(TOKEN, options, { fetch: intake.fetch })).toBeNull();
    }
    expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
    expect(intake.received).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(refused.length);
    for (const [message] of warn.mock.calls) {
      expect(String(message)).toMatch(MISSING);
      expect(String(message)).not.toContain(TOKEN);
    }
  });

  it('leaves the token in the address when the page names no organization', () => {
    const warn = warnings();
    history.replaceState(history.state, '', `${startUrl}&probara-recording=${TOKEN}`);
    const intake = fakeIntake();
    const options = {} as RecorderOptions;
    expect(startRecorderFromUrlWith(options, { fetch: intake.fetch })).toBeNull();
    expect(location.href).toBe(`${startUrl}&probara-recording=${TOKEN}`);
    expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
    expect(intake.received).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(MISSING);
  });

  it('sends up to 20 organizations, trimmed, in capitals and each once', async () => {
    const twenty = Array.from(
      { length: 20 },
      (_, index) => `01JACME${String(index).padStart(19, '0')}`,
    );
    const { recorder, intake } = start({
      organizations: [` ${BETA.toLowerCase()} `, ACME, BETA, ...twenty.slice(2)],
    });
    await vi.waitFor(() => {
      expect(recorder.state).toBe('ready');
    });
    expect(intake.received[0]?.organizations).toBe([BETA, ACME, ...twenty.slice(2)].join(','));
    recorder.close();

    const all = start({ organizations: twenty });
    await vi.waitFor(() => {
      expect(all.recorder.state).toBe('ready');
    });
    expect(all.intake.received[0]?.organizations).toBe(twenty.join(','));
  });
});

/** Opens the recorder, records a moment and stops: the recording is being watched. */
async function recordAndStop(options: Partial<RecorderOptions> = {}) {
  const started = start({ locale: 'en', ...options });
  await vi.waitFor(() => {
    expect(started.recorder.state).toBe('ready');
  });
  button(started.root(), 'Start recording').click();
  await vi.waitFor(() => {
    expect(started.recorder.state).toBe('recording');
  }, 5000);
  await new Promise((resolve) => setTimeout(resolve, 300));
  button(started.root(), 'Stop').click();
  await vi.waitFor(() => {
    expect(started.recorder.state).toBe('review');
  }, 10_000);
  return started;
}

const sent = (intake: ReturnType<typeof fakeIntake>, ending: string): boolean =>
  intake.received.some((request) => request.path.split('?')[0]?.endsWith(ending) === true);

describe('the API origin', () => {
  it("sends to Probara's API unless the page names another", async () => {
    const byDefault = start();
    await vi.waitFor(() => {
      expect(byDefault.recorder.state).toBe('ready');
    });
    expect(byDefault.intake.received[0]?.origin).toBe('https://app.probara.net');
    byDefault.recorder.close();

    const named = start({ apiOrigin: 'https://api.example.test/ignored/path' });
    await vi.waitFor(() => {
      expect(named.recorder.state).toBe('ready');
    });
    expect(named.intake.received[0]?.origin).toBe('https://api.example.test');
  });

  it('names both causes of a refusal when the link gets no answer from another origin', async () => {
    const refused = (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'));
    for (const [locale, words] of [
      [
        'en',
        `This page cannot record: ${location.hostname} must be a recording domain of the organization in Probara, and the page must name the organization in the recorder's organizations option.`,
      ],
      [
        'es',
        `Esta página no puede grabar: ${location.hostname} debe ser un dominio de grabación de la organización en Probara, y la página debe indicar la organización en la opción organizations de la grabadora.`,
      ],
    ] as const) {
      const { recorder, root } = start({ locale }, { fetch: refused });
      await vi.waitFor(() => {
        expect(recorder.state).toBe('failed');
      });
      expect(root().textContent).toContain(words);
      recorder.close();
    }
  });

  it('keeps the usual failure for the same origin and for an answered failure', async () => {
    const refused = (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'));
    const sameOrigin = start({ locale: 'en', apiOrigin: location.origin }, { fetch: refused });
    await vi.waitFor(() => {
      expect(sameOrigin.recorder.state).toBe('failed');
    });
    expect(sameOrigin.root().textContent).toContain('Your recording could not be sent.');
    expect(sameOrigin.root().textContent).not.toContain('must be a recording domain');
    sameOrigin.recorder.close();

    const answered = (): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'internal' } }), { status: 500 }),
      );
    const crossOrigin = start({ locale: 'en' }, { fetch: answered });
    await vi.waitFor(() => {
      expect(crossOrigin.recorder.state).toBe('failed');
    });
    expect(crossOrigin.root().textContent).toContain('Your recording could not be sent.');
    expect(crossOrigin.root().textContent).not.toContain('must be a recording domain');
  });
});

describe('the ready card and the recording watched before sending', () => {
  it('turns the microphone on with a quiet toggle', async () => {
    const asked: boolean[] = [];
    const { recorder, root } = start(
      { locale: 'en' },
      {
        acquireMedia: (options) => {
          asked.push(options.microphone);
          return Promise.resolve({ stream: canvasStream(), release: () => undefined });
        },
      },
    );
    await vi.waitFor(() => {
      expect(recorder.state).toBe('ready');
    });
    const toggle = button(root(), 'Unmute mic');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    toggle.click();
    expect(button(root(), 'Mute mic').getAttribute('aria-pressed')).toBe('true');
    button(root(), 'Start recording').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('recording');
    }, 5000);
    expect(asked).toEqual([true]);
  }, 15_000);

  it('sends the title the page gives, which the visitor never edits', async () => {
    const { recorder, intake, root } = start({ title: 'From the page' });
    await vi.waitFor(() => {
      expect(recorder.state).toBe('ready');
    });
    expect(intake.received[0]?.path).toBe(`${TOKEN}?title=From+the+page`);
    expect(root().querySelector('input')).toBeNull();
  });

  it('records again only once confirmed: the watched recording is aborted, a new one starts', async () => {
    const { recorder, intake, root } = await recordAndStop();
    button(root(), 'Record again').click();
    expect(root().textContent).toContain('Record again?');
    expect(root().textContent).toContain('This recording is deleted and nothing is sent.');
    button(root(), 'Cancel').click();
    expect(recorder.state).toBe('review');
    expect(intake.received.some((request) => request.method === 'DELETE')).toBe(false);

    button(root(), 'Record again').click();
    button(root(), 'Record again').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('recording');
    }, 5000);
    expect(intake.received.filter((request) => request.method === 'DELETE')).toHaveLength(1);
    expect(intake.received.filter((request) => request.path.endsWith('/submissions'))).toHaveLength(
      2,
    );
    expect(sent(intake, '/finalize')).toBe(false);
    expect(sent(intake, '/complete')).toBe(false);
  }, 20_000);

  it('discards a watched recording only once confirmed, finalizing nothing', async () => {
    const { recorder, intake, root } = await recordAndStop();
    button(root(), 'Discard').click();
    expect(root().textContent).toContain('Discard this recording?');
    button(root(), 'Discard').click();
    await vi.waitFor(() => {
      expect(recorder.state).toBe('ready');
    });
    await vi.waitFor(() => {
      expect(intake.received.at(-1)).toMatchObject({ method: 'DELETE', keepalive: false });
    });
    expect(sent(intake, '/finalize')).toBe(false);
    expect(sent(intake, '/complete')).toBe(false);
    expect(root().querySelector('video')?.hidden).toBe(true);
  }, 20_000);
});
