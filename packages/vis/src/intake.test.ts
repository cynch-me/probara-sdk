import { describe, expect, it } from 'vitest';
import { INTAKE_PATH, IntakeError, createIntake, type IntakeFetch } from './intake.js';

const TOKEN = 'link.TOKEN_secret-1';
const ORIGIN = 'https://app.example.com';
const LINK = {
  organizationName: 'Acme',
  title: 'Checkout bug',
  reference: 'SUP-1',
  folder: null,
  microphone: true,
  recordingMaxMinutes: 30,
  expiresAt: null,
};
const SUBMISSION = { visUlid: '01JVIS', submissionToken: 'sub.TOKEN-2', expiresAt: 99 };

interface Call {
  url: string;
  init: RequestInit;
}

/** A fetch answering each call in turn, recording what it was asked. */
function fakeFetch(...answers: (Response | Error)[]): IntakeFetch & { calls: Call[] } {
  const calls: Call[] = [];
  const fetch = (input: string, init: RequestInit): Promise<Response> => {
    calls.push({ url: input, init });
    const answer = answers.shift() ?? new Response(null, { status: 204 });
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return Object.assign(fetch, { calls });
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SAFE = {
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  cache: 'no-store',
  redirect: 'error',
  mode: 'cors',
};

describe('the recording intake client', () => {
  it('reads the link with its parameters, sending no credentials and no referrer', async () => {
    const fetch = fakeFetch(json(LINK));
    const intake = createIntake({ apiOrigin: `${ORIGIN}/ignored/path?q=1`, token: TOKEN, fetch });
    await expect(
      intake.readLink({
        title: 'My title',
        reference: 'R 1',
        folder: '01JFOLDER',
        microphone: false,
      }),
    ).resolves.toEqual(LINK);
    expect(fetch.calls).toEqual([
      {
        url: `${ORIGIN}${INTAKE_PATH}link.TOKEN_secret-1?title=My+title&reference=R+1&folder=01JFOLDER&microphone=false`,
        init: expect.objectContaining({ method: 'GET', ...SAFE }) as RequestInit,
      },
    ]);
    expect(new Headers(fetch.calls[0]?.init.headers).has('authorization')).toBe(false);
    expect(intake.prefix).toBe(`${ORIGIN}${INTAKE_PATH}`);
  });

  it('refuses an API origin that is not http or https', () => {
    for (const apiOrigin of ['javascript:alert(1)', 'not a url', 'file:///etc']) {
      expect(() => createIntake({ apiOrigin, token: TOKEN, fetch: fakeFetch() })).toThrow(
        TypeError,
      );
    }
  });

  it('starts a submission and drives its uploads, finalize and abort with its own token', async () => {
    const upload = { uploadUlid: '01JUP', partSize: 8, maxBytes: 64 };
    const fetch = fakeFetch(
      json(SUBMISSION, 201),
      json(upload, 201),
      json({ uploadUlid: '01JUP', partNumber: 1, byteSize: 3 }),
      json({ kind: 'video' }),
      json({ kind: 'console' }),
      json({ visUlid: '01JVIS', status: 'ready' }),
      new Response(null, { status: 204 }),
    );
    const intake = createIntake({ apiOrigin: ORIGIN, token: TOKEN, fetch });
    const submission = await intake.start({ title: 'T', capturedAt: 5 });
    expect(submission.visUlid).toBe('01JVIS');
    await expect(submission.createUpload('video/webm')).resolves.toEqual(upload);
    await submission.putPart('01JUP', 1, new Blob(['abc']));
    await submission.complete('01JUP');
    await submission.putAsset('console', new Uint8Array([31, 139]));
    await submission.finalize(1234);
    await submission.abort({ keepalive: true });

    const base = `${ORIGIN}${INTAKE_PATH}link.TOKEN_secret-1/submissions`;
    const sub = `${base}/sub.TOKEN-2`;
    expect(fetch.calls.map((call) => `${call.init.method ?? ''} ${call.url}`)).toEqual([
      `POST ${base}`,
      `POST ${sub}/uploads`,
      `PUT ${sub}/uploads/01JUP/parts/1`,
      `POST ${sub}/uploads/01JUP/complete`,
      `PUT ${sub}/assets/console`,
      `POST ${sub}/finalize`,
      `DELETE ${sub}`,
    ]);
    for (const call of fetch.calls) expect(call.init).toMatchObject(SAFE);
    expect(JSON.parse(fetch.calls[0]?.init.body as string)).toEqual({ title: 'T', capturedAt: 5 });
    expect(JSON.parse(fetch.calls[1]?.init.body as string)).toEqual({
      kind: 'video',
      contentType: 'video/webm',
    });
    expect(fetch.calls[2]?.init.body).toBeInstanceOf(Blob);
    const asset = new Headers(fetch.calls[4]?.init.headers);
    expect([asset.get('content-type'), asset.get('content-encoding')]).toEqual([
      'application/x-ndjson',
      'gzip',
    ]);
    expect(JSON.parse(fetch.calls[5]?.init.body as string)).toEqual({ durationMs: 1234 });
    expect(new Headers(fetch.calls[5]?.init.headers).get('content-type')).toBe('application/json');
    expect(fetch.calls[6]?.init.keepalive).toBe(true);
    expect(fetch.calls[0]?.init.keepalive).toBeUndefined();
  });

  it('turns every refusal into an IntakeError that never names the tokens', async () => {
    const fetch = fakeFetch(
      json({ error: { code: 'not_found', message: 'recording link not found' } }, 404),
      json({ error: { code: 'too_many_requests' } }, 429),
      json(
        { error: { code: 'validation_failed', details: { reason: 'recording_too_long' } } },
        422,
      ),
      new TypeError('Failed to fetch'),
      json({ organizationName: 'Acme' }),
      new Response('<html>', { status: 502 }),
    );
    const intake = createIntake({ apiOrigin: ORIGIN, token: TOKEN, fetch });
    const outcomes: unknown[] = [];
    for (let i = 0; i < 6; i += 1) {
      outcomes.push(await intake.readLink().catch((error: unknown) => error));
    }
    for (const outcome of outcomes) {
      expect(outcome).toBeInstanceOf(IntakeError);
      expect((outcome as Error).message).not.toContain('TOKEN');
    }
    expect(
      outcomes.map((outcome) => {
        const error = outcome as IntakeError;
        return [error.status, error.code, error.reason];
      }),
    ).toEqual([
      [404, 'not_found', null],
      [429, 'too_many_requests', null],
      [422, 'validation_failed', 'recording_too_long'],
      [null, 'network', null],
      [200, 'invalid_response', null],
      [502, null, null],
    ]);
  });

  it('refuses a submission answer whose token could not be sent back', async () => {
    const fetch = fakeFetch(json({ ...SUBMISSION, submissionToken: 'has space' }, 201));
    const intake = createIntake({ apiOrigin: ORIGIN, token: TOKEN, fetch });
    await expect(intake.start({})).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('the recording intake client: requests that never end', () => {
  const hanging = () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetch: IntakeFetch = (_input, init) => {
      signals.push(init.signal);
      return new Promise<Response>(() => undefined);
    };
    return { fetch, signals };
  };

  it('gives up on a request with no answer in time, as no answer, and cancels it', async () => {
    const { fetch, signals } = hanging();
    const intake = createIntake({ apiOrigin: ORIGIN, token: TOKEN, fetch, timeoutMs: 20 });
    const error: unknown = await intake.readLink().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IntakeError);
    expect(error).toMatchObject({ status: null, code: 'timeout' });
    expect(signals[0]?.aborted).toBe(true);
  });

  it('gives up on an answer whose body never ends', async () => {
    const fetch: IntakeFetch = () =>
      Promise.resolve(
        new Response(new ReadableStream({ start: () => undefined }), { status: 200 }),
      );
    const intake = createIntake({ apiOrigin: ORIGIN, token: TOKEN, fetch, timeoutMs: 20 });
    await expect(intake.readLink()).rejects.toMatchObject({ status: null, code: 'timeout' });
  });

  it('gives the uploads longer than the other requests', async () => {
    let held = false;
    const fetch: IntakeFetch = (_input, init) => {
      if (init.method === 'POST' && !held) {
        held = true;
        return Promise.resolve(json(SUBMISSION, 201));
      }
      // Every other request answers after 60 ms.
      return new Promise((resolve) =>
        setTimeout(() => {
          resolve(new Response(null, { status: 204 }));
        }, 60),
      );
    };
    const intake = createIntake({
      apiOrigin: ORIGIN,
      token: TOKEN,
      fetch,
      timeoutMs: 20,
      uploadTimeoutMs: 500,
    });
    const submission = await intake.start({});
    await expect(submission.putPart('01JUP', 1, new Blob(['abc']))).resolves.toBeUndefined();
    await expect(
      submission.putAsset('console', new Uint8Array([31, 139])),
    ).resolves.toBeUndefined();
    await expect(submission.complete('01JUP')).rejects.toMatchObject({ code: 'timeout' });
    await expect(submission.finalize(1)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('gives the finalize one more second for every 8 MiB of video uploaded', async () => {
    let held = false;
    const fetch: IntakeFetch = (_input, init) => {
      if (init.method === 'POST' && !held) {
        held = true;
        return Promise.resolve(json(SUBMISSION, 201));
      }
      // Every other request answers after 60 ms.
      return new Promise((resolve) =>
        setTimeout(() => {
          resolve(new Response(null, { status: 204 }));
        }, 60),
      );
    };
    const intake = createIntake({
      apiOrigin: ORIGIN,
      token: TOKEN,
      fetch,
      timeoutMs: 20,
      uploadTimeoutMs: 500,
    });
    const submission = await intake.start({});
    await submission.putPart('01JUP', 1, new Blob([new Uint8Array(8 * 1024 * 1024)]));
    await expect(submission.complete('01JUP')).rejects.toMatchObject({ code: 'timeout' });
    await expect(submission.finalize(1)).resolves.toBeUndefined();
  });
});
