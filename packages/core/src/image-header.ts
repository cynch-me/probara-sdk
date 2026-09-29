/**
 * Image dimensions read from the first bytes of a PNG, JPEG or WebP file, without decoding it.
 * The parsers follow the ones the Probara server applies before it accepts an image (cynch-tcms
 * `apps/worker/src/domain/image-dimensions.ts`), so core predicts the same verdict.
 */

/** The width and height of an image, in pixels. */
export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

/** Bytes core reads from the start of an image: enough for a JPEG frame header after its metadata. */
export const IMAGE_HEADER_BYTES = 256 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** JPEG start-of-frame markers (SOF0..SOF15 except DHT, JPG and DAC), which carry the size. */
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u24le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return ((u16be(bytes, offset) << 16) | u16be(bytes, offset + 2)) >>> 0;
}

/** The IHDR width and height that follow the 8-byte PNG signature. */
function pngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 24 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    return undefined;
  }
  if (asciiAt(bytes, 12, 4) !== 'IHDR') return undefined;
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

/** The size in the first start-of-frame segment, scanning the markers that precede it. */
function jpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1] ?? 0;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = u16be(bytes, offset);
    if (length < 2) return undefined;
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (offset + 7 >= bytes.length) return undefined;
      return { width: u16be(bytes, offset + 5), height: u16be(bytes, offset + 3) };
    }
    offset += length;
  }
  return undefined;
}

/** The canvas size of a RIFF WebP: extended (VP8X), lossless (VP8L) or lossy (VP8). */
function webpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 30 || asciiAt(bytes, 0, 4) !== 'RIFF' || asciiAt(bytes, 8, 4) !== 'WEBP') {
    return undefined;
  }
  const chunk = asciiAt(bytes, 12, 4);
  if (chunk === 'VP8X') return { width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
  if (chunk === 'VP8L') {
    const bits = (u24le(bytes, 21) | ((bytes[24] ?? 0) << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  // The server reads both 16-bit fields whole, scale bits included; so does core.
  if (chunk === 'VP8 ') {
    return {
      width: (bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8),
      height: (bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8),
    };
  }
  return undefined;
}

/**
 * The dimensions of an image of content type `type` (`image/png`, `image/jpeg` or `image/webp`)
 * from its first bytes, or `undefined` when they cannot be read there.
 */
export function imageDimensionsOf(bytes: Uint8Array, type: string): ImageDimensions | undefined {
  switch (type) {
    case 'image/png':
      return pngDimensions(bytes);
    case 'image/jpeg':
      return jpegDimensions(bytes);
    case 'image/webp':
      return webpDimensions(bytes);
    default:
      return undefined;
  }
}
