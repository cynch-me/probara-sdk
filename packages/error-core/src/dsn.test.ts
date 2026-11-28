import { describe, expect, it } from 'vitest';
import { parseDsn } from './index.js';

describe('parseDsn', () => {
  it('turns https://<key>@<host>/ into the envelope endpoint of that host', () => {
    expect(parseDsn('https://pek_abc.def@ingest.probara.test/')).toEqual({
      key: 'pek_abc.def',
      origin: 'https://ingest.probara.test',
      endpoint: 'https://ingest.probara.test/api/v1/public/errors/envelope?key=pek_abc.def',
    });
  });

  it('keeps a port and a base path, without a trailing slash', () => {
    expect(parseDsn('http://k1@localhost:8787/probara')?.endpoint).toBe(
      'http://localhost:8787/probara/api/v1/public/errors/envelope?key=k1',
    );
  });

  it('is null for anything that is not an http(s) DSN with a key', () => {
    for (const dsn of [
      '',
      'https://ingest.probara.test/',
      'ftp://k@host/',
      'not a dsn',
      'https://k@/',
    ]) {
      expect(parseDsn(dsn), dsn).toBeNull();
    }
  });
});
