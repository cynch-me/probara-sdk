/**
 * The metadata handshake: a page answers custom metadata over DOM events, and the extension side
 * reads it. Plain `EventTarget`s stand in for the window both sides share.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_METADATA_BYTES,
  METADATA_PROTOCOL_VERSION,
  METADATA_REQUEST_EVENT,
  METADATA_RESPONSE_EVENT,
  answerMetadataRequests,
  normalizeMetadata,
  requestPageMetadata,
} from './metadata.js';

/** Answers every request on `target` with `detail`, as a page of any shape could. */
function answerWith(target: EventTarget, detail: (id: string) => unknown): void {
  target.addEventListener(METADATA_REQUEST_EVENT, (event) => {
    const request = JSON.parse((event as CustomEvent<string>).detail) as { id: string };
    target.dispatchEvent(new CustomEvent(METADATA_RESPONSE_EVENT, { detail: detail(request.id) }));
  });
}

/** Every response the page side dispatched on `target`. */
function responses(target: EventTarget): unknown[] {
  const seen: unknown[] = [];
  target.addEventListener(METADATA_RESPONSE_EVENT, (event) => {
    seen.push((event as CustomEvent).detail);
  });
  return seen;
}

/** A metadata object whose JSON is exactly `bytes` UTF-8 bytes long. */
function ofBytes(bytes: number): Record<string, string> {
  const overhead = JSON.stringify({ k: '' }).length;
  return { k: 'x'.repeat(bytes - overhead) };
}

describe('normalizeMetadata', () => {
  it('keeps a JSON object as JSON would carry it', () => {
    const date = new Date(0);
    expect(
      normalizeMetadata({
        plan: 'pro',
        seats: 3,
        flags: [true],
        at: date,
        skip: undefined,
        fn: () => 1,
      }),
    ).toEqual({ plan: 'pro', seats: 3, flags: [true], at: '1970-01-01T00:00:00.000Z' });
  });

  it('keeps metadata of exactly the limit and refuses one byte more, counting UTF-8 bytes', () => {
    expect(MAX_METADATA_BYTES).toBe(10 * 1024);
    expect(normalizeMetadata(ofBytes(MAX_METADATA_BYTES))).toEqual(ofBytes(MAX_METADATA_BYTES));
    expect(normalizeMetadata(ofBytes(MAX_METADATA_BYTES + 1))).toBeNull();
    // 'é' is two bytes: 5,121 of them are 10,242 bytes, over the limit in bytes though not in characters.
    expect(normalizeMetadata({ k: 'é'.repeat(5_118) })).toBeNull();
  });

  it('refuses what is not a JSON object, never throwing', () => {
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    const throwing = {
      toJSON() {
        throw new Error('nope');
      },
    };
    for (const value of [null, undefined, 'text', 3, [1, 2], cycle, throwing, 10n, () => ({})]) {
      expect(normalizeMetadata(value)).toBeNull();
    }
  });
});

describe('the metadata handshake', () => {
  it('reads what the page side answers', async () => {
    const window = new EventTarget();
    answerMetadataRequests(() => ({ userId: 'u-1', cart: { items: 2 } }), { target: window });
    await expect(requestPageMetadata({ target: window })).resolves.toEqual({
      userId: 'u-1',
      cart: { items: 2 },
    });
  });

  it('carries strings over the events, so it works across content script worlds', () => {
    const window = new EventTarget();
    const seen = responses(window);
    answerMetadataRequests(() => ({ a: 1 }), { target: window });
    window.dispatchEvent(
      new CustomEvent(METADATA_REQUEST_EVENT, {
        detail: JSON.stringify({ version: METADATA_PROTOCOL_VERSION, id: 'req-1' }),
      }),
    );
    expect(seen).toEqual([JSON.stringify({ version: 1, id: 'req-1', metadata: { a: 1 } })]);
  });

  it('answers null for metadata that throws or breaks the limit', async () => {
    const window = new EventTarget();
    let collect: () => unknown = () => {
      throw new Error('provider failed');
    };
    answerMetadataRequests(() => collect(), { target: window });
    await expect(requestPageMetadata({ target: window })).resolves.toBeNull();
    collect = () => ofBytes(MAX_METADATA_BYTES + 1);
    await expect(requestPageMetadata({ target: window })).resolves.toBeNull();
  });

  it('ignores malformed requests', () => {
    const window = new EventTarget();
    const seen = responses(window);
    answerMetadataRequests(() => ({ a: 1 }), { target: window });
    for (const detail of [
      { version: 1, id: 'object-not-string' },
      'not json',
      JSON.stringify({ version: 2, id: 'other-version' }),
      JSON.stringify({ version: 1 }),
      JSON.stringify({ version: 1, id: 'bad id with spaces' }),
      JSON.stringify({ version: 1, id: 'x'.repeat(65) }),
      JSON.stringify({ version: 1, id: 'ok', pad: 'x'.repeat(1000) }),
    ]) {
      window.dispatchEvent(new CustomEvent(METADATA_REQUEST_EVENT, { detail }));
    }
    expect(seen).toEqual([]);
  });

  it('stops answering once stopped', async () => {
    const window = new EventTarget();
    const stop = answerMetadataRequests(() => ({ a: 1 }), { target: window });
    stop();
    await expect(requestPageMetadata({ target: window, timeoutMs: 20 })).resolves.toBeNull();
  });

  it('resolves null when nobody answers in time', async () => {
    const started = Date.now();
    await expect(
      requestPageMetadata({ target: new EventTarget(), timeoutMs: 30 }),
    ).resolves.toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it('treats every answer as untrusted: only a valid answer to its own request counts', async () => {
    const window = new EventTarget();
    const big = JSON.stringify({ version: 1, id: 'x', metadata: ofBytes(MAX_METADATA_BYTES + 1) });
    const forged: ((id: string) => unknown)[] = [
      (id) => ({ version: 1, id, metadata: { object: 'detail' } }),
      (id) => JSON.stringify({ version: 1, id: `${id}-other`, metadata: { other: true } }),
      (id) => JSON.stringify({ version: 2, id, metadata: { future: true } }),
      () => 'not json',
      (id) => JSON.stringify({ version: 1, id, metadata: ['array'] }),
      (id) => big.replace('"x"', JSON.stringify(id)),
      (id) => JSON.stringify({ version: 1, id, metadata: { ok: 'finally' } }),
    ];
    for (const answer of forged) answerWith(window, answer);
    await expect(requestPageMetadata({ target: window, timeoutMs: 50 })).resolves.toEqual({
      ok: 'finally',
    });
  });

  it('reads an answer of null as no metadata, at once', async () => {
    const window = new EventTarget();
    answerWith(window, (id) => JSON.stringify({ version: 1, id, metadata: null }));
    const started = Date.now();
    await expect(requestPageMetadata({ target: window, timeoutMs: 1000 })).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });
});
