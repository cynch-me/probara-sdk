import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BODY_LIMITS,
  readRequestBody,
  readResponseBody,
  textBody,
  type BodyLimits,
} from './network-body.js';

const limits: BodyLimits = { maxBodyBytes: 10, maxBodyReadBytes: 100, bodyReadTimeoutMs: 50 };

/** A stream that sends `chunks` and then never ends. */
function endless(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    },
  });
}

describe('the default limits', () => {
  it('keep 64 KiB of text, read at most 1 MiB and wait 10 seconds for a body', () => {
    expect(DEFAULT_BODY_LIMITS).toEqual({
      maxBodyBytes: 65_536,
      maxBodyReadBytes: 1_048_576,
      bodyReadTimeoutMs: 10_000,
    });
  });
});

describe('textBody', () => {
  it('keeps a text within the cap whole', () => {
    expect(textBody('{"a":1}', 10)).toEqual({
      text: '{"a":1}',
      truncated: false,
      size: 7,
      omitted: null,
    });
  });

  it('keeps the start of a longer text, cut on a character boundary, with its real size', () => {
    // "é" is two bytes: the cap falls inside the fifth one.
    expect(textBody('ééééé-tail', 9)).toEqual({
      text: 'éééé',
      truncated: true,
      size: 15,
      omitted: null,
    });
  });
});

describe('readRequestBody', () => {
  it('is null without a body', async () => {
    expect(await readRequestBody(undefined, null, limits)).toBeNull();
    expect(await readRequestBody(null, null, limits)).toBeNull();
  });

  it('keeps strings, URL parameters and text blobs as text', async () => {
    expect(await readRequestBody('hello', null, limits)).toMatchObject({ text: 'hello', size: 5 });
    expect(await readRequestBody(new URLSearchParams({ q: 'shoes' }), null, limits)).toMatchObject({
      text: 'q=shoes',
      size: 7,
    });
    expect(
      await readRequestBody(
        new Blob(['{"long":"json body"}'], { type: 'application/json' }),
        null,
        limits,
      ),
    ).toEqual({ text: '{"long":"j', truncated: true, size: 20, omitted: null });
  });

  it('describes form data fields, files by name and size', async () => {
    const form = new FormData();
    form.append('name', 'Ana');
    form.append('photo', new Blob(['12345'], { type: 'image/png' }), 'me.png');
    expect(await readRequestBody(form, null, { ...limits, maxBodyBytes: 100 })).toEqual({
      text: 'name=Ana&photo=%5Bfile+me.png%2C+5+bytes%5D',
      truncated: false,
      size: null,
      omitted: null,
    });
  });

  it('omits binary data, streams and oversized blobs without reading them', async () => {
    expect(await readRequestBody(new Uint8Array([0, 1, 2, 255]), null, limits)).toEqual({
      text: null,
      truncated: false,
      size: 4,
      omitted: 'binary',
    });
    expect(await readRequestBody(new ArrayBuffer(8), null, limits)).toMatchObject({
      size: 8,
      omitted: 'binary',
    });
    expect(
      await readRequestBody(new Blob([new Uint8Array(4)], { type: 'image/png' }), null, limits),
    ).toMatchObject({
      size: 4,
      omitted: 'binary',
    });
    expect(await readRequestBody(endless(['x']), null, limits)).toEqual({
      text: null,
      truncated: false,
      size: null,
      omitted: 'stream',
    });
    expect(await readRequestBody(new Blob(['x'.repeat(101)]), null, limits)).toMatchObject({
      text: null,
      size: 101,
      omitted: 'too_large',
    });
  });

  it('reads bytes sent with a text content type as text', async () => {
    const bytes = new TextEncoder().encode('{"a":1}');
    expect(await readRequestBody(bytes, 'application/json', limits)).toMatchObject({
      text: '{"a":1}',
      omitted: null,
    });
  });
});

describe('readResponseBody', () => {
  it('keeps a text response up to the cap, with the size of the whole body', async () => {
    const response = new Response('0123456789abcdef', {
      headers: { 'content-type': 'text/plain' },
    });
    expect(await readResponseBody(response, limits)).toEqual({
      text: '0123456789',
      truncated: true,
      size: 16,
      omitted: null,
    });
  });

  it('is null for a response without a body', async () => {
    expect(await readResponseBody(new Response(null, { status: 204 }), limits)).toBeNull();
  });

  it('reads a clone without changing what the original body delivers', async () => {
    const original = new Response('0123456789abcdef');
    const body = await readResponseBody(original.clone(), limits);
    expect(body?.text).toBe('0123456789');
    expect(await original.text()).toBe('0123456789abcdef');
  });

  it('omits a binary response by its content type, or by its bytes when it has none', async () => {
    const image = new Response(new Uint8Array(6), {
      headers: { 'content-type': 'image/png', 'content-length': '6' },
    });
    expect(await readResponseBody(image, limits)).toEqual({
      text: null,
      truncated: false,
      size: 6,
      omitted: 'binary',
    });
    const untyped = new Response(new Uint8Array([0xff, 0xfe, 0x00, 0x81]));
    untyped.headers.delete('content-type');
    expect(await readResponseBody(untyped, limits)).toMatchObject({ size: 4, omitted: 'binary' });
  });

  it('does not read an event stream, nor wait for a body that never ends', async () => {
    const events = new Response(endless(['data: 1\n\n']), {
      headers: { 'content-type': 'text/event-stream' },
    });
    expect(await readResponseBody(events, limits)).toEqual({
      text: null,
      truncated: false,
      size: null,
      omitted: 'stream',
    });
    const started = Date.now();
    const hanging = new Response(endless(['{"partial":']), {
      headers: { 'content-type': 'application/json' },
    });
    expect(await readResponseBody(hanging, limits)).toMatchObject({
      text: null,
      omitted: 'stream',
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('stops reading a body larger than the read limit', async () => {
    const declared = new Response('x'.repeat(200), {
      headers: { 'content-type': 'text/plain', 'content-length': '200' },
    });
    expect(await readResponseBody(declared, limits)).toEqual({
      text: null,
      truncated: false,
      size: 200,
      omitted: 'too_large',
    });
    const undeclared = new Response(endless(['x'.repeat(60), 'x'.repeat(60)]), {
      headers: { 'content-type': 'text/plain' },
    });
    expect(await readResponseBody(undeclared, limits)).toEqual({
      text: null,
      truncated: false,
      size: null,
      omitted: 'too_large',
    });
  });
});
