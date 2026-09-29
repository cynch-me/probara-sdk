/** Result attachments: how core names, reads and groups the files an adapter hands it. */
import { openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { AttachmentUpload } from './client.js';
import { IMAGE_HEADER_BYTES, imageDimensionsOf } from './image-header.js';
import {
  DENIED_ATTACHMENT_CONTENT_TYPES,
  IMAGE_ATTACHMENT_CONTENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILENAME_LENGTH,
  MAX_ATTACHMENTS_PER_STAGE_REQUEST,
  MAX_IMAGE_ATTACHMENT_BYTES,
  MAX_IMAGE_ATTACHMENT_DIMENSION,
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

/**
 * Why an attachment is not uploaded: `reason` is the same for every file it applies to (warnings
 * are grouped by it), `detail` tells this file's figures, such as its dimensions.
 */
export interface AttachmentProblem {
  readonly reason: string;
  readonly detail?: string;
}

const MIB = 1024 * 1024;

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
const TOO_LARGE = `it is larger than ${MAX_ATTACHMENT_BYTES / MIB} MiB`;
const IMAGE_TOO_LARGE = `it is a PNG, JPEG or WebP image larger than ${MAX_IMAGE_ATTACHMENT_BYTES / MIB} MiB, which Probara refuses`;
const IMAGE_TOO_WIDE = `it is a PNG, JPEG or WebP image wider or taller than ${MAX_IMAGE_ATTACHMENT_DIMENSION} px, which Probara refuses`;
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
 * The attachments of one result that core will try to upload, in order, and the ones it skips: no
 * source or a refused content type. File contents are not read here; a `body` is copied. The cap
 * of 20 per result applies later, to the files that load.
 */
export function prepareAttachments(inputs: unknown): {
  attachments: PreparedAttachment[];
  skipped: SkippedAttachment[];
} {
  const attachments: PreparedAttachment[] = [];
  const skipped: SkippedAttachment[] = [];
  if (inputs === undefined || inputs === null) return { attachments, skipped };
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
  return { attachments, skipped };
}

/** Why `size` bytes cannot be uploaded, if they cannot. */
function sizeProblem(size: number): AttachmentProblem | undefined {
  if (size === 0) return { reason: EMPTY };
  if (size > MAX_ATTACHMENT_BYTES) return { reason: TOO_LARGE };
  return undefined;
}

/**
 * Why the server would refuse `content` as an image, if it would: a PNG, JPEG or WebP (by the
 * declared type the server sees, `Blob.type`) over 10 MiB, or whose header states more than 8192
 * px on a side. Only the first {@link IMAGE_HEADER_BYTES} are read; an image whose size is not
 * found there is left to the server.
 */
async function imageProblem(content: Blob): Promise<AttachmentProblem | undefined> {
  if (!IMAGE_ATTACHMENT_CONTENT_TYPES.has(content.type)) return undefined;
  if (content.size > MAX_IMAGE_ATTACHMENT_BYTES) {
    return { reason: IMAGE_TOO_LARGE, detail: `${(content.size / MIB).toFixed(1)} MiB` };
  }
  const header = new Uint8Array(await content.slice(0, IMAGE_HEADER_BYTES).arrayBuffer());
  const dimensions = imageDimensionsOf(header, content.type);
  if (
    dimensions === undefined ||
    (dimensions.width <= MAX_IMAGE_ATTACHMENT_DIMENSION &&
      dimensions.height <= MAX_IMAGE_ATTACHMENT_DIMENSION)
  ) {
    return undefined;
  }
  return { reason: IMAGE_TOO_WIDE, detail: `${dimensions.width}x${dimensions.height} px` };
}

async function checked(
  name: string,
  content: Blob,
): Promise<{ upload: AttachmentUpload } | { skipped: AttachmentProblem }> {
  const problem = await imageProblem(content);
  return problem === undefined ? { upload: { name, content } } : { skipped: problem };
}

/**
 * The upload of one attachment, or why it is skipped. A file is checked (it exists, is a regular
 * file, is neither empty nor too large, and is not an image the server would refuse) and opened
 * with `fs.openAsBlob`, so it is streamed when sent instead of being read into memory; only the
 * header of an image is read.
 */
export async function loadAttachment(
  attachment: PreparedAttachment,
): Promise<{ upload: AttachmentUpload } | { skipped: AttachmentProblem }> {
  const { name, contentType, source } = attachment;
  try {
    if ('blob' in source) {
      const problem = sizeProblem(source.blob.size);
      return problem === undefined ? await checked(name, source.blob) : { skipped: problem };
    }
    const info = await stat(source.path);
    if (!info.isFile()) return { skipped: { reason: NOT_A_FILE } };
    const problem = sizeProblem(info.size);
    if (problem !== undefined) return { skipped: problem };
    return await checked(name, await openAsBlob(source.path, { type: contentType }));
  } catch {
    return { skipped: { reason: MISSING } };
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
