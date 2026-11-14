import { describe, expect, it } from 'vitest';
import { gzipNdjson, toNdjson, type ConsoleEntry, type UserEventEntry } from './index.js';

const entries: [ConsoleEntry, UserEventEntry] = [
  { t: 1, ts: 1001, level: 'log', args: ['line one\nline two'] },
  { t: 2, ts: 1002, type: 'input', url: 'https://a.test/', value: '***' },
];

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

describe('NDJSON', () => {
  it('writes one JSON document per entry, each on its own line', () => {
    const text = toNdjson(entries);
    expect(text.endsWith('\n')).toBe(true);
    const lines = text.split('\n').slice(0, -1);
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual(entries);
  });

  it('writes nothing for no entries', () => {
    expect(toNdjson([])).toBe('');
  });

  it('gzips the lines with the platform CompressionStream', async () => {
    const bytes = await gzipNdjson(entries);
    // The gzip magic number.
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    expect(await gunzip(bytes)).toBe(toNdjson(entries));
  });
});
