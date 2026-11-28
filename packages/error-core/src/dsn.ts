/** Where an SDK sends its events: read from `https://<key>@<host>/`. */
export interface Dsn {
  /** The project's public ingest key. */
  key: string;
  /** The scheme, host and port of the Probara API. */
  origin: string;
  /** The envelope endpoint, the key in its query. */
  endpoint: string;
}

const DSN = /^(https?):\/\/([^@/\s?#]+)@([^/\s?#@]+)(\/[^\s?#]*)?$/i;

/** The DSN `dsn` names; `null` when it is not an http(s) URL with a key. */
export function parseDsn(dsn: string): Dsn | null {
  const match = DSN.exec(dsn.trim());
  if (match === null) return null;
  const [, scheme = '', key = '', host = '', path = ''] = match;
  const origin = `${scheme.toLowerCase()}://${host}`;
  const base = path.replace(/\/+$/, '');
  return {
    key,
    origin,
    endpoint: `${origin}${base}/api/v1/public/errors/envelope?key=${encodeURIComponent(key)}`,
  };
}
