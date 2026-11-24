/**
 * The watched copy of a WebM recording, with its duration. `MediaRecorder` writes WebM without
 * one, so a player learns how long the video is only by reading it to the end: its time bar grows
 * as it loads and a viewer cannot jump ahead at once. The copy has the known duration written
 * into its Info element, read across the chunks: `MediaRecorder` ends a slice at any write once
 * the timeslice passed, so a late first frame splits the header. The Segment and the Clusters it writes
 * have an unknown size, so a longer Info moves nothing another element points at; a recording laid
 * out otherwise (a seek head, a Segment of known size) is left as it was. The chunks themselves,
 * the bytes uploaded, never change: Probara makes the uploaded WebM seekable when the Vis is
 * finalized.
 */

const EBML_ID = 0x1a45dfa3;
const SEGMENT_ID = 0x18538067;
const SEEK_HEAD_ID = 0x114d9b74;
const INFO_ID = 0x1549a966;
const CLUSTER_ID = 0x1f43b675;
const TIMECODE_SCALE_ID = 0x2ad7b1;
const DURATION_ID = 0x4489;
/** Nanoseconds per timestamp unit when the Info names no scale: milliseconds. */
const DEFAULT_TIMECODE_SCALE = 1_000_000;
/** How much of the recording is read to find its Info, which comes right after the header. */
const HEAD_BYTES = 64 * 1024;

interface Element {
  id: number;
  /** Where the element starts, at its ID. */
  start: number;
  /** Where its body starts. */
  body: number;
  /** Where it ends; `null` for an unknown size. */
  end: number | null;
}

/** The variable-length integer at `offset`, or `null` when there is none in `bytes`. */
function readVint(
  bytes: Uint8Array,
  offset: number,
  keepMarker: boolean,
): { value: number | null; length: number } | null {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while ((first & (0x80 >> (length - 1))) === 0) length += 1;
  if (offset + length > bytes.length) return null;
  const mask = 0xff >> length;
  let value = keepMarker ? first : first & mask;
  let allOnes = (first & mask) === mask;
  for (let i = 1; i < length; i += 1) {
    const byte = bytes[offset + i] ?? 0;
    if (byte !== 0xff) allOnes = false;
    value = value * 256 + byte;
  }
  // A size with every value bit set is unknown: the element runs to the end of its parent.
  return { value: !keepMarker && allOnes ? null : value, length };
}

function readElement(bytes: Uint8Array, offset: number): Element | null {
  const id = readVint(bytes, offset, true);
  if (id === null || id.value === null || id.length > 4) return null;
  const size = readVint(bytes, offset + id.length, false);
  if (size === null) return null;
  const body = offset + id.length + size.length;
  return { id: id.value, start: offset, body, end: size.value === null ? null : body + size.value };
}

/** `size` as an element size, in as few bytes as hold it. */
function encodeSize(size: number): number[] {
  let length = 1;
  // Every value bit set would read as an unknown size.
  while (size >= 2 ** (7 * length) - 1) length += 1;
  const out: number[] = [];
  let rest = size;
  for (let i = 0; i < length; i += 1) {
    out.unshift(rest % 256);
    rest = Math.floor(rest / 256);
  }
  out[0] = (out[0] ?? 0) | (0x80 >> (length - 1));
  return out;
}

/** The Info rewritten with `durationMs`, or `null` when its children cannot all be read. */
function infoWithDuration(head: Uint8Array, info: Element, end: number, durationMs: number) {
  const kept: number[] = [];
  let scale = DEFAULT_TIMECODE_SCALE;
  for (let offset = info.body; offset < end;) {
    const child = readElement(head, offset);
    if (child === null || child.end === null || child.end > end) return null;
    if (child.id === TIMECODE_SCALE_ID) {
      scale = 0;
      for (let i = child.body; i < child.end; i += 1) scale = scale * 256 + (head[i] ?? 0);
    }
    if (child.id !== DURATION_ID) kept.push(...head.subarray(child.start, child.end));
    offset = child.end;
  }
  if (!(scale > 0)) return null;
  const duration = new DataView(new ArrayBuffer(8));
  duration.setFloat64(0, (durationMs * DEFAULT_TIMECODE_SCALE) / scale);
  const body = [...kept, 0x44, 0x89, 0x88, ...new Uint8Array(duration.buffer)];
  return Uint8Array.from([0x15, 0x49, 0xa9, 0x66, ...encodeSize(body.length), ...body]);
}

/**
 * The whole recording, of `type`, to be watched: with `durationMs` in its Info when the chunks
 * are WebM laid out as `MediaRecorder` writes it, as recorded otherwise.
 */
export async function withWebmDuration(
  chunks: readonly Blob[],
  durationMs: number,
  type: string,
): Promise<Blob> {
  const whole = new Blob([...chunks], { type });
  const unchanged = (): Blob => whole;
  if (whole.size === 0 || !Number.isFinite(durationMs) || durationMs <= 0) return unchanged();
  const head = new Uint8Array(await whole.slice(0, HEAD_BYTES).arrayBuffer());
  const ebml = readElement(head, 0);
  if (ebml?.id !== EBML_ID || ebml.end === null) return unchanged();
  const segment = readElement(head, ebml.end);
  if (segment?.id !== SEGMENT_ID || segment.end !== null) return unchanged();
  for (let offset = segment.body; ;) {
    const element = readElement(head, offset);
    if (element === null || element.end === null || element.end > head.length) return unchanged();
    // A seek head points at positions after the Info; a Cluster means there is no Info to patch.
    if (element.id === SEEK_HEAD_ID || element.id === CLUSTER_ID) return unchanged();
    if (element.id === INFO_ID) {
      const info = infoWithDuration(head, element, element.end, durationMs);
      if (info === null) return unchanged();
      return new Blob([head.subarray(0, element.start), info, whole.slice(element.end)], { type });
    }
    offset = element.end;
  }
}
