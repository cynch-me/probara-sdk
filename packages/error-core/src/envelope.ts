/**
 * Envelopes: one JSON header line, then for each item a JSON header line, holding the payload's
 * length in bytes, and the payload.
 */
interface Utf8Encoder {
  encode(input: string): Uint8Array;
}

let encoder: Utf8Encoder | undefined;

/** `text` as UTF-8 bytes. */
export function utf8(text: string): Uint8Array {
  encoder ??= new (globalThis as unknown as { TextEncoder: new () => Utf8Encoder }).TextEncoder();
  return encoder.encode(text);
}

export interface EnvelopeItem {
  header: { type: string; content_type?: string };
  payload: string | Uint8Array;
}

/** The bytes of an envelope. */
export function serializeEnvelope(
  header: Record<string, unknown>,
  items: readonly EnvelopeItem[],
): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [utf8(JSON.stringify(header))];
  for (const item of items) {
    const payload = typeof item.payload === 'string' ? utf8(item.payload) : item.payload;
    parts.push(utf8(JSON.stringify({ ...item.header, length: payload.length })), payload);
  }
  const size = parts.reduce((sum, part) => sum + part.length, 0) + parts.length - 1;
  const out = new Uint8Array(size);
  let offset = 0;
  parts.forEach((part, index) => {
    if (index > 0) out[offset++] = 0x0a;
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}
