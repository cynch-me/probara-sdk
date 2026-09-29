/** Result attachments: how core names, reads and groups the files an adapter hands it. */
import { openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { AttachmentUpload } from './client.js';
import {
  DENIED_ATTACHMENT_CONTENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILENAME_LENGTH,
  MAX_ATTACHMENTS_PER_RESULT,
  MAX_ATTACHMENTS_PER_STAGE_REQUEST,
  MAX_STAGE_REQUEST_BYTES,
} from './limits.js';
import { toSingleLine, truncate } from './text.js';

/**
 * One file of a result, in the shape of Playwright's `TestResult.attachments`: a file on disk
 * (`path`) or content in memory (`body`).
 */
export interface AttachmentInput {
  /** Name of the file, used when there is no `path`. An extension is added from `contentType`. */
  name?: string | undefined;
  /** Such as `image/png`. Defaults to `application/octet-stream`. */
  contentType?: string | undefined;
  /** A file to upload, read lazily when its result is uploaded. Wins over `body`. */
  path?: string | undefined;
  body?: Uint8Array | string | undefined;
}

/** An attachment accepted by `addResult`: named and typed, its content still to be read. */
export interface PreparedAttachment {
  readonly name: string;
  readonly contentType: string;
  readonly source: { readonly path: string } | { readonly blob: Blob };
}

/** An attachment core does not upload, and why. */
export interface SkippedAttachment {
  readonly name: string;
  readonly reason: string;
}

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const DEFAULT_NAME = 'attachment';
const CONTENT_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:\s*;[\x20-\x7e]*)?$/i;
const EXTENSION = /\.[A-Za-z0-9]{1,8}$/;
const EXTENSIONS: Readonly<Record<string, string>> = {
  'application/gzip': 'gz',
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/xml': 'xml',
  'application/zip': 'zip',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'text/html': 'html',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'text/xml': 'xml',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

const MISSING = 'its file is missing or unreadable';
const NOT_A_FILE = 'its path is not a file';
const EMPTY = 'it is empty';
const TOO_LARGE = `it is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MiB`;
const DENIED = 'its content type is refused by Probara (executables and scripts)';
const NO_SOURCE = 'it has neither a path nor a body';
const NOT_AN_OBJECT = 'it is not an object';

function essenceOf(contentType: string): string {
  return (contentType.split(';')[0] ?? '').trim().toLowerCase();
}

function contentTypeOf(value: unknown): string {
  const type = typeof value === 'string' ? toSingleLine(value) : '';
  return CONTENT_TYPE.test(type) ? type : DEFAULT_CONTENT_TYPE;
}

/** `name` cut to the stored length, its extension kept. */
function fitName(name: string): string {
  if (name.length <= MAX_ATTACHMENT_FILENAME_LENGTH) return name;
  const extension = EXTENSION.exec(name)?.[0] ?? '';
  const stem = name.slice(0, name.length - extension.length);
  return `${truncate(stem, MAX_ATTACHMENT_FILENAME_LENGTH - extension.length)}${extension}`;
}

/**
 * The stored name of an attachment: the base name of its `path`, else its `name` with an
 * extension from its content type when it has none, on one line and without path separators.
 */
function fileNameOf(input: AttachmentInput, contentType: string): string {
  const path = typeof input.path === 'string' ? input.path : '';
  const fromPath = toSingleLine(path === '' ? '' : basename(path));
  // Typed as a string, but an untyped adapter may pass anything.
  const rawName: unknown = input.name;
  const given =
    fromPath !== '' ? fromPath : toSingleLine(typeof rawName === 'string' ? rawName : '');
  let name = given.replace(/[\\/]/g, '_');
  if (name === '') name = DEFAULT_NAME;
  const extension = EXTENSIONS[essenceOf(contentType)];
  if (fromPath === '' && extension !== undefined && !EXTENSION.test(name)) {
    name = `${name}.${extension}`;
  }
  return fitName(name);
}

/**
 * The attachments of one result that core will try to upload, in order, and the ones it skips:
 * no source, a refused content type, or beyond the {@link MAX_ATTACHMENTS_PER_RESULT} a result
 * holds (reported as one `overLimit` count). File contents are not read here; a `body` is copied.
 */
export function prepareAttachments(inputs: unknown): {
  attachments: PreparedAttachment[];
  skipped: SkippedAttachment[];
  overLimit: number;
} {
  const attachments: PreparedAttachment[] = [];
  const skipped: SkippedAttachment[] = [];
  if (inputs === undefined || inputs === null) return { attachments, skipped, overLimit: 0 };
  const list: unknown[] = Array.isArray(inputs) ? inputs : [inputs];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) {
      skipped.push({ name: DEFAULT_NAME, reason: NOT_AN_OBJECT });
      continue;
    }
    const input = item as AttachmentInput;
    const contentType = contentTypeOf(input.contentType);
    const name = fileNameOf(input, contentType);
    if (DENIED_ATTACHMENT_CONTENT_TYPES.has(essenceOf(contentType))) {
      skipped.push({ name, reason: DENIED });
    } else if (typeof input.path === 'string' && input.path.trim() !== '') {
      attachments.push({ name, contentType, source: { path: input.path } });
    } else if (typeof input.body === 'string' || input.body instanceof Uint8Array) {
      // The Blob holds a copy, so the adapter may reuse its buffer.
      const blob = new Blob([input.body], { type: contentType });
      attachments.push({ name, contentType, source: { blob } });
    } else {
      skipped.push({ name, reason: NO_SOURCE });
    }
  }
  const overLimit = Math.max(0, attachments.length - MAX_ATTACHMENTS_PER_RESULT);
  attachments.length -= overLimit;
  return { attachments, skipped, overLimit };
}

/** Why `size` bytes cannot be uploaded, if they cannot. */
function sizeProblem(size: number): string | undefined {
  if (size === 0) return EMPTY;
  if (size > MAX_ATTACHMENT_BYTES) return TOO_LARGE;
  return undefined;
}

/**
 * The upload of one attachment, or why it is skipped. A file is checked (it exists, is a regular
 * file, is neither empty nor too large) and opened with `fs.openAsBlob`, so it is streamed when
 * sent instead of being read into memory.
 */
export async function loadAttachment(
  attachment: PreparedAttachment,
): Promise<{ upload: AttachmentUpload } | { skipped: string }> {
  const { name, contentType, source } = attachment;
  if ('blob' in source) {
    const problem = sizeProblem(source.blob.size);
    return problem === undefined
      ? { upload: { name, content: source.blob } }
      : { skipped: problem };
  }
  try {
    const info = await stat(source.path);
    if (!info.isFile()) return { skipped: NOT_A_FILE };
    const problem = sizeProblem(info.size);
    if (problem !== undefined) return { skipped: problem };
    return { upload: { name, content: await openAsBlob(source.path, { type: contentType }) } };
  } catch {
    return { skipped: MISSING };
  }
}

/**
 * Groups uploads into stage requests, in order: at most {@link MAX_ATTACHMENTS_PER_STAGE_REQUEST}
 * files and {@link MAX_STAGE_REQUEST_BYTES} bytes each (a single file always fits, since it is at
 * most {@link MAX_ATTACHMENT_BYTES}).
 */
export function groupStageRequests(uploads: readonly AttachmentUpload[]): AttachmentUpload[][] {
  const groups: AttachmentUpload[][] = [];
  let current: AttachmentUpload[] = [];
  let bytes = 0;
  for (const upload of uploads) {
    const size = upload.content.size;
    if (
      current.length > 0 &&
      (current.length >= MAX_ATTACHMENTS_PER_STAGE_REQUEST ||
        bytes + size > MAX_STAGE_REQUEST_BYTES)
    ) {
      groups.push(current);
      current = [];
      bytes = 0;
    }
    current.push(upload);
    bytes += size;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
