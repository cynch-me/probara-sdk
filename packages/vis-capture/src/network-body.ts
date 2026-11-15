/**
 * Request and response bodies as network entries keep them: text up to a byte cap, marked
 * `truncated` with the size of the whole body; binary data, streams and oversized bodies are not
 * read to the end and carry the reason they were omitted. A response is only ever read through a
 * clone, so the page's own body is never consumed, delayed or changed.
 */
import type { BodyOmittedReason, NetworkBody } from './entries.js';

export interface BodyLimits {
  /** The UTF-8 bytes of text kept from one body; the rest is cut and the body marked truncated. */
  maxBodyBytes: number;
  /** A body larger than this is not read further and is omitted as `too_large`. */
  maxBodyReadBytes: number;
  /** A body still arriving after this many milliseconds is omitted as `stream`. */
  bodyReadTimeoutMs: number;
}

export const DEFAULT_BODY_LIMITS: Readonly<BodyLimits> = Object.freeze({
  maxBodyBytes: 64 * 1024,
  maxBodyReadBytes: 1024 * 1024,
  bodyReadTimeoutMs: 10_000,
});

let encoder: TextEncoder | undefined;

function utf8(text: string): Uint8Array {
  // Created on first use: loading the module touches no browser API.
  encoder ??= new TextEncoder();
  return encoder.encode(text);
}

/** `text` kept up to `maxBytes` UTF-8 bytes, cut on a character boundary. */
export function textBody(text: string, maxBytes: number): NetworkBody {
  const bytes = utf8(text);
  if (bytes.length <= maxBytes) {
    return { text, truncated: false, size: bytes.length, omitted: null };
  }
  // A streaming decode leaves out the character the cut falls inside.
  const kept = new TextDecoder().decode(bytes.subarray(0, Math.max(0, maxBytes)), { stream: true });
  return { text: kept, truncated: true, size: bytes.length, omitted: null };
}

export function omittedBody(reason: BodyOmittedReason, size: number | null): NetworkBody {
  return { text: null, truncated: false, size, omitted: reason };
}

/** `text`, `binary`, or `unknown` without a content type. */
function contentKind(contentType: string | null): 'text' | 'binary' | 'unknown' {
  const mime = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime === '') return 'unknown';
  if (
    mime.startsWith('text/') ||
    /json|xml|javascript|ecmascript|graphql|x-www-form-urlencoded|csv|yaml|html/.test(mime)
  ) {
    return 'text';
  }
  return 'binary';
}

/** Responses that keep sending: Server-Sent Events and multipart streams. */
function isStreamType(contentType: string | null): boolean {
  const mime = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  return mime === 'text/event-stream' || mime === 'multipart/x-mixed-replace';
}

/** `bytes` as kept text, or `null` when they are not valid UTF-8 (binary data). */
function decodeKept(bytes: Uint8Array, cut: boolean): string | null {
  try {
    // Fatal on invalid bytes; a cut body leaves its last partial character out.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: cut });
  } catch {
    return null;
  }
}

function bytesBody(bytes: Uint8Array, contentType: string | null, limits: BodyLimits): NetworkBody {
  if (bytes.byteLength > limits.maxBodyReadBytes) return omittedBody('too_large', bytes.byteLength);
  if (contentKind(contentType) === 'binary') return omittedBody('binary', bytes.byteLength);
  const cut = bytes.byteLength > limits.maxBodyBytes;
  const text = decodeKept(bytes.subarray(0, limits.maxBodyBytes), cut);
  if (text === null) return omittedBody('binary', bytes.byteLength);
  return { text, truncated: cut, size: bytes.byteLength, omitted: null };
}

/** The `[object X]` tag of a value: it holds across windows, where `instanceof` does not. */
function tagOf(value: unknown): string {
  return Object.prototype.toString.call(value).slice(8, -1);
}

function describeForm(form: FormData, limits: BodyLimits): NetworkBody {
  const params = new URLSearchParams();
  form.forEach((value, name) => {
    if (typeof value === 'string') params.append(name, value);
    else params.append(name, `[file ${value.name}, ${String(value.size)} bytes]`);
  });
  // The multipart encoding the browser sends is not known here.
  return { ...textBody(params.toString(), limits.maxBodyBytes), size: null };
}

async function blobBody(
  blob: Blob,
  contentType: string | null,
  limits: BodyLimits,
): Promise<NetworkBody> {
  if (blob.size > limits.maxBodyReadBytes) return omittedBody('too_large', blob.size);
  const type = blob.type !== '' ? blob.type : contentType;
  if (contentKind(type) === 'binary') return omittedBody('binary', blob.size);
  return bytesBody(new Uint8Array(await blob.arrayBuffer()), type, limits);
}

/**
 * The body a page passes to `fetch`, `XMLHttpRequest.send` or `sendBeacon`, as kept. A stream is
 * never read (that would consume it); a Blob is read, which leaves it unchanged for the page.
 */
export async function readRequestBody(
  body: unknown,
  contentType: string | null,
  limits: BodyLimits,
): Promise<NetworkBody | null> {
  if (body === undefined || body === null) return null;
  if (typeof body === 'string') return textBody(body, limits.maxBodyBytes);
  const tag = tagOf(body);
  if (tag === 'URLSearchParams') {
    return textBody((body as URLSearchParams).toString(), limits.maxBodyBytes);
  }
  if (tag === 'FormData') return describeForm(body as FormData, limits);
  if (tag === 'Blob' || tag === 'File') return blobBody(body as Blob, contentType, limits);
  if (tag === 'ReadableStream') return omittedBody('stream', null);
  if (tag === 'ArrayBuffer' || tag === 'SharedArrayBuffer') {
    return bytesBody(
      new Uint8Array(body as ArrayBuffer),
      contentType ?? 'application/octet-stream',
      limits,
    );
  }
  if (ArrayBuffer.isView(body)) {
    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return bytesBody(bytes, contentType ?? 'application/octet-stream', limits);
  }
  if (typeof (body as { nodeType?: unknown }).nodeType === 'number') {
    try {
      return textBody(new XMLSerializer().serializeToString(body as Node), limits.maxBodyBytes);
    } catch {
      return omittedBody('unsupported', null);
    }
  }
  return omittedBody('unsupported', null);
}

function declaredLength(headers: Headers): number | null {
  const value = headers.get('content-length');
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value);
}

const TIMED_OUT = Symbol('timed out');

/** Reads `stream` within the limits; it is cancelled when it is not read to the end. */
async function streamBody(
  stream: ReadableStream<Uint8Array>,
  declared: number | null,
  limits: BodyLimits,
): Promise<NetworkBody> {
  const reader = stream.getReader();
  const stop = (body: NetworkBody): NetworkBody => {
    reader.cancel().catch(() => undefined);
    return body;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      resolve(TIMED_OUT);
    }, limits.bodyReadTimeoutMs);
  });
  const kept: Uint8Array[] = [];
  let keptBytes = 0;
  let total = 0;
  try {
    for (;;) {
      const result = await Promise.race([reader.read(), timeout]);
      if (result === TIMED_OUT) return stop(omittedBody('stream', declared));
      if (result.done) break;
      total += result.value.byteLength;
      if (total > limits.maxBodyReadBytes) return stop(omittedBody('too_large', declared));
      if (keptBytes < limits.maxBodyBytes) {
        const part = result.value.subarray(0, limits.maxBodyBytes - keptBytes);
        kept.push(part);
        keptBytes += part.byteLength;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  const bytes = new Uint8Array(keptBytes);
  let offset = 0;
  for (const part of kept) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  const cut = total > keptBytes;
  const text = decodeKept(bytes, cut);
  if (text === null) return omittedBody('binary', total);
  return { text, truncated: cut, size: total, omitted: null };
}

/** The response-like value whose body is read: a `Response` or a `Request` clone. */
interface BodySource {
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  readonly type?: string;
}

/**
 * The body of `response`, as kept. Pass a clone (`response.clone()`): it is read or cancelled.
 * Rejects when reading fails (the request was aborted meanwhile).
 */
export async function readResponseBody(
  response: BodySource,
  limits: BodyLimits,
): Promise<NetworkBody | null> {
  const cancel = (body: NetworkBody): NetworkBody => {
    // An unread clone would otherwise hold a copy of everything the page reads.
    response.body?.cancel().catch(() => undefined);
    return body;
  };
  if (response.type === 'opaque' || response.type === 'opaqueredirect') {
    return cancel(omittedBody('opaque', null));
  }
  if (response.body === null) return null;
  const contentType = response.headers.get('content-type');
  const declared = declaredLength(response.headers);
  if (isStreamType(contentType)) return cancel(omittedBody('stream', declared));
  if (declared !== null && declared > limits.maxBodyReadBytes) {
    return cancel(omittedBody('too_large', declared));
  }
  if (contentKind(contentType) === 'binary') return cancel(omittedBody('binary', declared));
  return streamBody(response.body, declared, limits);
}
