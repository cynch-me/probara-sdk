/**
 * The video's upload in parts while it records: the recorder's chunks are joined into parts of
 * exactly the upload's part size, each sent as soon as it is whole, one at a time and in order;
 * what is left when the recording ends is the last, smaller part.
 */
import { IntakeError } from './intake.js';

/** Why the upload failed on the page's side. */
export class PartUploadError extends Error {
  /** `too_large`: the video outgrew the largest upload; `empty`: it holds no byte. */
  readonly code: 'too_large' | 'empty';

  constructor(code: 'too_large' | 'empty') {
    super(
      code === 'too_large' ? 'the video is larger than the upload allows' : 'the video is empty',
    );
    this.name = 'PartUploadError';
    this.code = code;
  }
}

export interface PartUploaderOptions {
  partSize: number;
  maxBytes: number;
  upload: (partNumber: number, part: Blob) => Promise<void>;
  /** Called once, with the first failure. */
  onError?: (error: unknown) => void;
  /** Attempts per part; 3 unless given. */
  attempts?: number;
  /** Waits before a retry; the attempt number grows the wait. */
  sleep?: (ms: number) => Promise<void>;
}

export interface PartUploader {
  /** The first failure, once there is one. */
  readonly error: unknown;
  /** The bytes of the video added so far, sent or not. */
  readonly bytes: number;
  /** Adds a chunk of the video; does nothing after a failure. */
  add(chunk: Blob): void;
  /** Sends the last part and waits for every part; rejects with the first failure. */
  finish(): Promise<{ bytes: number; parts: number }>;
}

const RETRY_DELAY_MS = 1000;

/** An answer worth another attempt: none at all, too many requests, or a server error. */
function retryable(error: unknown): boolean {
  if (!(error instanceof IntakeError)) return false;
  return error.status === null || error.status === 429 || error.status >= 500;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createPartUploader(options: PartUploaderOptions): PartUploader {
  const attempts = options.attempts ?? 3;
  const sleep = options.sleep ?? wait;
  let pending: Blob[] = [];
  let pendingBytes = 0;
  let total = 0;
  let sent = 0;
  let failed = false;
  let failure: unknown;
  let queue: Promise<void> = Promise.resolve();

  function fail(error: unknown): void {
    if (failed) return;
    failed = true;
    failure = error;
    pending = [];
    pendingBytes = 0;
    try {
      options.onError?.(error);
    } catch {
      // A listener never changes the outcome.
    }
  }

  async function send(partNumber: number, part: Blob): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      if (failed) return;
      try {
        await options.upload(partNumber, part);
        return;
      } catch (error) {
        if (attempt >= attempts || !retryable(error)) {
          fail(error);
          return;
        }
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  function enqueue(part: Blob): void {
    sent += 1;
    const partNumber = sent;
    queue = queue.then(() => send(partNumber, part));
  }

  function flushWhole(): void {
    while (pendingBytes >= options.partSize) {
      const joined = new Blob(pending);
      enqueue(joined.slice(0, options.partSize));
      const rest = joined.slice(options.partSize);
      pending = rest.size === 0 ? [] : [rest];
      pendingBytes = rest.size;
    }
  }

  return {
    get error() {
      return failure;
    },
    get bytes() {
      return total;
    },
    add(chunk) {
      if (failed || chunk.size === 0) return;
      total += chunk.size;
      if (total > options.maxBytes) {
        fail(new PartUploadError('too_large'));
        return;
      }
      pending.push(chunk);
      pendingBytes += chunk.size;
      flushWhole();
    },
    async finish() {
      if (!failed && total === 0) fail(new PartUploadError('empty'));
      if (!failed && pendingBytes > 0) {
        enqueue(new Blob(pending));
        pending = [];
        pendingBytes = 0;
      }
      await queue;
      if (failed) throw failure;
      return { bytes: total, parts: sent };
    },
  };
}
