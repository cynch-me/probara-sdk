/**
 * What a file to upload as a Vis is, read from its first bytes (never its name), and the length of
 * a video read from its container: the `mvhd` box of an MP4, the Info of a WebM Segment. Both
 * are plain byte reads, without a media library.
 */
import type { FileHandle } from 'node:fs/promises';

export type Media =
  | { kind: 'video'; contentType: 'video/mp4' | 'video/webm' }
  | { kind: 'screenshot'; contentType: 'image/png' | 'image/jpeg' | 'image/webp' };

/** How many bytes {@link mediaOf} needs. */
export const MEDIA_HEAD_BYTES = 64;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const EBML = [0x1a, 0x45, 0xdf, 0xa3];

function startsWith(bytes: Uint8Array, prefix: readonly number[], at = 0): boolean {
  return prefix.every((byte, index) => bytes[at + index] === byte);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** The media of a file from its first bytes; `undefined` for anything else. */
export function mediaOf(head: Uint8Array): Media | undefined {
  if (startsWith(head, PNG)) return { kind: 'screenshot', contentType: 'image/png' };
  if (startsWith(head, [0xff, 0xd8, 0xff]))
    return { kind: 'screenshot', contentType: 'image/jpeg' };
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') {
    return { kind: 'screenshot', contentType: 'image/webp' };
  }
  if (ascii(head, 4, 8) === 'ftyp' && ascii(head, 8, 12) !== 'qt  ') {
    return { kind: 'video', contentType: 'video/mp4' };
  }
  if (startsWith(head, EBML) && webmDocType(head)) {
    return { kind: 'video', contentType: 'video/webm' };
  }
  return undefined;
}

/** A variable-length EBML integer at `at`: its value (marker bit kept for ids) and length. */
function vint(bytes: Uint8Array, at: number, keepMarker: boolean) {
  const first = bytes[at];
  if (first === undefined || first === 0) return undefined;
  let length = 1;
  while ((first & (0x80 >> (length - 1))) === 0) length += 1;
  if (at + length > bytes.length) return undefined;
  let value = keepMarker ? first : first & (0xff >> length);
  let unknown = value === 0xff >> length;
  for (let index = 1; index < length; index += 1) {
    const byte = bytes[at + index] ?? 0;
    value = value * 256 + byte;
    if (byte !== 0xff) unknown = false;
  }
  return { value, length, unknown: !keepMarker && unknown };
}

interface Element {
  id: number;
  /** Where its data starts. */
  start: number;
  /** Where its data ends; the end of the bytes for an unknown size. */
  end: number;
}

function elementAt(bytes: Uint8Array, at: number): Element | undefined {
  const id = vint(bytes, at, true);
  if (id === undefined) return undefined;
  const size = vint(bytes, at + id.length, false);
  if (size === undefined) return undefined;
  const start = at + id.length + size.length;
  return { id: id.value, start, end: size.unknown ? bytes.length : start + size.value };
}

function* children(bytes: Uint8Array, start: number, end: number): Generator<Element> {
  let at = start;
  while (at < end) {
    const element = elementAt(bytes, at);
    if (element === undefined) return;
    yield element;
    at = element.end;
  }
}

/** Whether the EBML header at the start of `head` names the `webm` document type. */
function webmDocType(head: Uint8Array): boolean {
  const header = elementAt(head, 0);
  if (header === undefined) return false;
  for (const child of children(head, header.start, Math.min(header.end, head.length))) {
    if (child.id === 0x4282) return ascii(head, child.start, child.end) === 'webm';
  }
  return false;
}

function uint(bytes: Uint8Array, start: number, end: number): number {
  let value = 0;
  for (let at = start; at < end; at += 1) value = value * 256 + (bytes[at] ?? 0);
  return value;
}

/** The bytes of `handle` from `position`, at most `length`. */
async function readAt(handle: FileHandle, position: number, length: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/** How much of a WebM file is read for its Info: it comes before the first Cluster. */
const WEBM_HEAD_BYTES = 1024 * 1024;

async function webmDurationMs(handle: FileHandle, size: number): Promise<number | undefined> {
  const bytes = await readAt(handle, 0, Math.min(size, WEBM_HEAD_BYTES));
  const header = elementAt(bytes, 0);
  if (header === undefined) return undefined;
  const segment = elementAt(bytes, header.end);
  if (segment?.id !== 0x18538067) return undefined;
  for (const child of children(bytes, segment.start, Math.min(segment.end, bytes.length))) {
    if (child.id === 0x1f43b675) return undefined;
    if (child.id !== 0x1549a966) continue;
    let scale = 1_000_000;
    let duration: number | undefined;
    for (const field of children(bytes, child.start, Math.min(child.end, bytes.length))) {
      if (field.id === 0x2ad7b1) scale = uint(bytes, field.start, field.end);
      if (field.id === 0x4489) {
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset + field.start,
          field.end - field.start,
        );
        if (field.end - field.start === 4) duration = view.getFloat32(0);
        if (field.end - field.start === 8) duration = view.getFloat64(0);
      }
    }
    if (duration === undefined || !Number.isFinite(duration) || duration <= 0) return undefined;
    return Math.round((duration * scale) / 1_000_000);
  }
  return undefined;
}

/** The largest `moov` box read for its `mvhd`. */
const MAX_MOOV_BYTES = 64 * 1024 * 1024;

async function mp4DurationMs(handle: FileHandle, size: number): Promise<number | undefined> {
  let at = 0;
  while (at + 8 <= size) {
    const head = await readAt(handle, at, 16);
    let boxSize = uint(head, 0, 4);
    let headerSize = 8;
    if (boxSize === 1) {
      boxSize = uint(head, 8, 16);
      headerSize = 16;
    } else if (boxSize === 0) boxSize = size - at;
    if (boxSize < headerSize) return undefined;
    if (ascii(head, 4, 8) === 'moov') {
      const length = Math.min(boxSize - headerSize, MAX_MOOV_BYTES);
      const moov = await readAt(handle, at + headerSize, length);
      let inner = 0;
      while (inner + 8 <= moov.length) {
        const childSize = uint(moov, inner, inner + 4);
        if (childSize < 8) return undefined;
        if (ascii(moov, inner + 4, inner + 8) === 'mvhd') {
          const body = inner + 8;
          const version = moov[body];
          const timescale =
            version === 1 ? uint(moov, body + 20, body + 24) : uint(moov, body + 12, body + 16);
          const duration =
            version === 1 ? uint(moov, body + 24, body + 32) : uint(moov, body + 16, body + 20);
          if (timescale === 0 || duration === 0 || duration === 0xffffffff) return undefined;
          return Math.round((duration * 1000) / timescale);
        }
        inner += childSize;
      }
      return undefined;
    }
    at += boxSize;
  }
  return undefined;
}

/** The length of the video in milliseconds, as its container records it; `undefined` when not. */
export async function videoDurationMs(
  handle: FileHandle,
  size: number,
  contentType: 'video/mp4' | 'video/webm',
): Promise<number | undefined> {
  return contentType === 'video/mp4' ? mp4DurationMs(handle, size) : webmDurationMs(handle, size);
}
