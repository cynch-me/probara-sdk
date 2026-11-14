/**
 * Custom metadata and its handshake over DOM events. A site registers what it knows about the
 * session (a user id, a plan, a feature flag) and the capture asks for it when it makes a Vis:
 *
 * - the page side, `answerMetadataRequests`, answers each request it hears on the window;
 * - the reader, `requestPageMetadata`, sends a request and waits for the answer to it.
 *
 * Both details are JSON strings, never objects: a string crosses between the page and a content
 * script of an extension, whose worlds do not share objects. Both sides treat what they receive as
 * untrusted: wrong types, another version, another request's id or anything over the limits is
 * ignored. The metadata itself keeps the server's limit, a JSON object of at most
 * `MAX_METADATA_BYTES` once serialized.
 */

/** The version of the handshake; each side ignores messages of another. */
export const METADATA_PROTOCOL_VERSION = 1;
/** The event a reader dispatches on the window to ask for metadata. */
export const METADATA_REQUEST_EVENT = 'probara-vis:metadata-request';
/** The event the page dispatches on the window to answer. */
export const METADATA_RESPONSE_EVENT = 'probara-vis:metadata-response';
/** The largest custom metadata a Vis keeps: its JSON in UTF-8 bytes (10 KiB). */
export const MAX_METADATA_BYTES = 10 * 1024;
/** How long `requestPageMetadata` waits for an answer by default. */
export const DEFAULT_METADATA_TIMEOUT_MS = 500;

/** Custom metadata: a JSON object. */
export type VisMetadata = Record<string, unknown>;

/** The window both sides share: `globalThis` unless another is given. */
export type MetadataEventTarget = Pick<
  EventTarget,
  'addEventListener' | 'removeEventListener' | 'dispatchEvent'
>;

export interface AnswerMetadataOptions {
  target?: MetadataEventTarget;
}

export interface RequestMetadataOptions {
  target?: MetadataEventTarget;
  /** How long to wait for an answer; `DEFAULT_METADATA_TIMEOUT_MS` unless given. */
  timeoutMs?: number;
}

/** The longest request detail a page reads. */
const MAX_REQUEST_LENGTH = 200;
/** The longest response detail a reader parses: the metadata, its envelope and the id. */
const MAX_RESPONSE_LENGTH = MAX_METADATA_BYTES + 200;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

let encoder: TextEncoder | undefined;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `value` as JSON would carry it, when it is a JSON object of at most `MAX_METADATA_BYTES`;
 * `null` otherwise (another type, a cycle, a `toJSON` that throws). Never throws.
 */
export function normalizeMetadata(value: unknown): VisMetadata | null {
  try {
    if (!isObject(value)) return null;
    const json = JSON.stringify(value);
    encoder ??= new TextEncoder();
    if (encoder.encode(json).length > MAX_METADATA_BYTES) return null;
    const parsed: unknown = JSON.parse(json);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The object of a JSON string detail of at most `maxLength` characters, or `undefined`. */
function parseDetail(event: Event, maxLength: number): Record<string, unknown> | undefined {
  try {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== 'string' || detail.length > maxLength) return undefined;
    const parsed: unknown = JSON.parse(detail);
    if (!isObject(parsed) || parsed['version'] !== METADATA_PROTOCOL_VERSION) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function validId(id: unknown): id is string {
  return typeof id === 'string' && REQUEST_ID.test(id);
}

function dispatch(target: MetadataEventTarget, type: string, detail: string): void {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

/**
 * Answers every metadata request on the window with what `collect` returns, normalized: `null`
 * when it throws or returns anything but a JSON object within the limit. Returns the function that
 * stops answering. Never throws into the page.
 */
export function answerMetadataRequests(
  collect: () => unknown,
  options: AnswerMetadataOptions = {},
): () => void {
  const target: MetadataEventTarget = options.target ?? globalThis;
  const listener = (event: Event): void => {
    try {
      const request = parseDetail(event, MAX_REQUEST_LENGTH);
      const id = request?.['id'];
      if (!validId(id)) return;
      let metadata: VisMetadata | null;
      try {
        metadata = normalizeMetadata(collect());
      } catch {
        metadata = null;
      }
      const answer = { version: METADATA_PROTOCOL_VERSION, id, metadata };
      dispatch(target, METADATA_RESPONSE_EVENT, JSON.stringify(answer));
    } catch {
      // Never throw into the page.
    }
  };
  try {
    target.addEventListener(METADATA_REQUEST_EVENT, listener);
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      target.removeEventListener(METADATA_REQUEST_EVENT, listener);
    } catch {
      // Never throw into the page.
    }
  };
}

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Asks the page for its metadata: resolves with the first valid answer to this request, or
 * `null` when the page answers `null` or nothing valid arrives within `timeoutMs`. Never
 * rejects.
 */
export function requestPageMetadata(
  options: RequestMetadataOptions = {},
): Promise<VisMetadata | null> {
  const target: MetadataEventTarget = options.target ?? globalThis;
  const timeoutMs = options.timeoutMs ?? DEFAULT_METADATA_TIMEOUT_MS;
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let id: string;
    const finish = (metadata: VisMetadata | null): void => {
      if (timer !== undefined) clearTimeout(timer);
      try {
        target.removeEventListener(METADATA_RESPONSE_EVENT, listener);
      } catch {
        // Nothing more to undo.
      }
      resolve(metadata);
    };
    const listener = (event: Event): void => {
      const answer = parseDetail(event, MAX_RESPONSE_LENGTH);
      if (answer === undefined || answer['id'] !== id) return;
      const metadata = answer['metadata'];
      if (metadata === null) {
        finish(null);
        return;
      }
      const normalized = normalizeMetadata(metadata);
      if (normalized !== null) finish(normalized);
    };
    try {
      id = randomId();
      target.addEventListener(METADATA_RESPONSE_EVENT, listener);
      timer = setTimeout(() => {
        finish(null);
      }, timeoutMs);
      dispatch(
        target,
        METADATA_REQUEST_EVENT,
        JSON.stringify({ version: METADATA_PROTOCOL_VERSION, id }),
      );
    } catch {
      finish(null);
    }
  });
}
