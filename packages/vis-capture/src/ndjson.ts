/**
 * The entries (diagnostics entries, or the events of a replay) as NDJSON: one JSON document per
 * entry, each ending with a newline.
 */
export function toNdjson(entries: readonly object[]): string {
  let text = '';
  for (const entry of entries) text += JSON.stringify(entry) + '\n';
  return text;
}

/** The NDJSON of the entries, gzip-compressed with the platform `CompressionStream`. */
export async function gzipNdjson(entries: readonly object[]): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([toNdjson(entries)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
