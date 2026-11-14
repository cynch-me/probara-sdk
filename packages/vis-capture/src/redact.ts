/**
 * The built-in redaction: secrets in text, headers and bodies are replaced with `REDACTED` before
 * anything leaves the page. It runs after the user's sanitizers, so they see the original values
 * and cannot undo it.
 */

/** What a redacted secret is replaced with. */
export const REDACTED = 'PROBARA_REDACTED';

/** Parts of key names that mark a credential wherever they appear in the key. */
const KEY_PARTS = [
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'api[_-]?key',
  'access[_-]?key',
  'private[_-]?key',
  'authorization',
  'cookie',
  'session[_-]?id',
  'credential',
  'card[_-]?number',
  'credit[_-]?card',
  'social[_-]?security',
  'signature',
  // Session cookies: PHPSESSID, and laravel_session, _app_session (Rails) and the like.
  'sessid',
  '_session(?![a-z0-9])',
];

/** Short key names that mark a credential only as the whole key. */
const WHOLE_KEYS = ['pass', 'pwd', 'auth', 'ssn', 'cvv', 'cvc', 'pin', 'session', 'sid', 'sig'];

const KEY_PART = new RegExp(KEY_PARTS.join('|'), 'i');
const WHOLE_KEY = new RegExp(`^(?:${WHOLE_KEYS.join('|')})$`, 'i');

/** `key` names a credential: `password`, `api_key`, `X-CSRF-Token`, `cvv`… */
function isSensitiveKey(key: string): boolean {
  return KEY_PART.test(key) || WHOLE_KEY.test(key);
}

/** Header names whose whole value is a credential, beyond the credential key names. */
function isSensitiveHeader(name: string): boolean {
  return isSensitiveKey(name) || /auth/i.test(name);
}

/** `Bearer <token>`, `Basic <token>` and `Digest <token>` credentials. */
const SCHEME = /\b(Bearer|Basic|Digest)(\s+)([A-Za-z0-9\-._~+/]+=*)/gi;
/**
 * Three base64url segments, the first a JSON object: a JWT. The first segment is only looked for
 * at the start of a run of base64url characters, which keeps the scan of a long run without dots
 * linear; the token may start later in that run, after a dash or an underscore (`id-eyJ…`).
 */
const JWT_HEAD = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{7,}(?=\.[A-Za-z0-9_-]{4,}\.)/g;
const JWT_TAIL = /\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/y;
/** The shortest first segment of a JWT: `eyJ` and four more characters. */
const JWT_MIN_HEAD = 7;

/** Where a JWT starts in `segment`: at its start, or after a dash or an underscore; -1 for none. */
function jwtStart(segment: string): number {
  for (let at = segment.indexOf('eyJ'); at !== -1; at = segment.indexOf('eyJ', at + 1)) {
    if (segment.length - at < JWT_MIN_HEAD) return -1;
    if (at === 0 || segment[at - 1] === '-' || segment[at - 1] === '_') return at;
  }
  return -1;
}

function redactJwts(text: string): string {
  let out = '';
  let kept = 0;
  for (const head of text.matchAll(JWT_HEAD)) {
    const offset = jwtStart(head[0]);
    const from = head.index + offset;
    if (offset === -1 || from < kept) continue;
    JWT_TAIL.lastIndex = head.index + head[0].length;
    if (!JWT_TAIL.test(text)) continue;
    out += text.slice(kept, from) + REDACTED;
    kept = JWT_TAIL.lastIndex;
  }
  return kept === 0 ? text : out + text.slice(kept);
}
/** Well-known provider token prefixes (payment, source hosting, cloud and chat keys). */
const PROVIDER_TOKENS = [
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
  /\bsk-(?:proj|ant)-[A-Za-z0-9_-]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g,
  /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g,
];
/**
 * The characters of a key: brackets and percent signs too, for form field names such as
 * `user[password]` and `user%5Bpassword%5D`.
 */
const RUN_CHAR = '[A-Za-z0-9_.\\-\\[\\]%]';
/**
 * The start of a run of key characters. A key is only looked for from there, and is the whole run:
 * a lookahead checks the run holds a credential part, then the run is taken whole. Each run is so
 * scanned a bounded number of times, which keeps a long unbroken run (a hex dump, a base64url
 * blob, a key name repeated) linear.
 */
const RUN_START = `(?<!${RUN_CHAR})`;
/** A run of key characters that holds one of `parts`. */
const keyRun = (parts: string): string => `${RUN_START}(?=${RUN_CHAR}*?(?:${parts}))${RUN_CHAR}+`;
/**
 * A credential key: a run holding a credential part anywhere, or a short credential name on its
 * own or as the last bracketed name of a form field (`user[pass]`, `user%5Bpass%5D`).
 */
const KEY = `${keyRun(KEY_PARTS.join('|'))}|(?:\\b|(?<=%5B))(?:${WHOLE_KEYS.join('|')})\\b(?:\\]|%5D)?`;
/** An `Authorization` key, `Proxy-Authorization` and the like, or `auth`. */
const AUTH_KEY = `(?:${keyRun('authorization')}|\\bauth\\b)`;
/** An unquoted value: it ends at whitespace, a quote or a query-string or JSON delimiter. */
const BARE = `[^\\s"'&,;}\\]]+`;
const KNOWN_SCHEME = '(?:Bearer|Basic|Digest)[ \\t]+';
const LEADING_SCHEME = new RegExp(`^${KNOWN_SCHEME}`, 'i');
/**
 * `<credential key> = value` or `: value`: query strings, form bodies, JSON-ish text and log
 * lines. A quoted value is taken whole, up to its closing quote or, when the text was cut, to the
 * end of the line; the quotes may be escaped, as in JSON inside a string. An unquoted value ends
 * at the first whitespace or delimiter, after its auth scheme when it has one.
 */
const KEY_VALUE = new RegExp(
  `(${KEY})((?:\\\\?["'])?\\s*[:=]\\s*)(` +
    `\\\\"(?:(?!\\\\")[^\\n])+(?:\\\\")?` +
    `|"(?:[^"\\\\\\n]|\\\\.)+"?` +
    `|'(?:[^'\\\\\\n]|\\\\.)+'?` +
    `|(?:${KNOWN_SCHEME})?${BARE})`,
  'gi',
);
/**
 * An unquoted `Authorization` value with any other scheme (`Token <key>`, `ApiKey <key>`): the
 * scheme word and the credential after it.
 */
const AUTH_VALUE = new RegExp(
  `(${AUTH_KEY}\\s*[:=]\\s*)` + `(?!${KNOWN_SCHEME})[A-Za-z][A-Za-z0-9_-]*[ \\t]+${BARE}`,
  'gi',
);
/** An unquoted `Authorization: Digest` value: every parameter up to the end of the line. */
const DIGEST_VALUE = new RegExp(`(${AUTH_KEY}\\s*[:=]\\s*Digest[ \\t]+)[^\\n]+`, 'gi');

/** What a matched credential value becomes: its quotes and a known auth scheme stay readable. */
function redactedValue(value: string): string {
  const open = /^(?:\\"|["'])/.exec(value)?.[0] ?? '';
  const closed = open !== '' && value.endsWith(open);
  const scheme = LEADING_SCHEME.exec(value.slice(open.length))?.[0] ?? '';
  return `${open}${scheme}${REDACTED}${closed ? open : ''}`;
}
/**
 * The password of `scheme://user:password@host`. The scheme is only looked for at the start of a
 * run of scheme characters, which keeps the scan of a long run (`a.a.a.`) linear.
 */
const URL_PASSWORD = /((?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s/:@?#]*:)[^\s/@?#]+(?=@)/gi;
/**
 * A part of a URL or form body between delimiters that holds percent-encoded characters, such as
 * `%7B%22token%22%3A%22…%22%7D`: it is decoded, redacted and encoded again.
 */
const ENCODED = /(?<![^\s&=?#"'<>])[^\s&=?#"'<>]*%[0-9A-Fa-f]{2}[^\s&=?#"'<>]*/g;
/** How many times percent-encoded text is decoded inside percent-encoded text. */
const MAX_DECODE_DEPTH = 2;
/** 13 to 19 digits, spaces or dashes between them, starting like a card number (2 to 6). */
const CARD = /\b[2-6](?:[ -]?\d){12,18}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** A `Basic` value looks like base64, not like an English word after "basic". */
function looksLikeCredential(scheme: string, token: string): boolean {
  if (scheme.toLowerCase() !== 'basic') return true;
  return token.length >= 8 && (/\d|=/.test(token) || (/[a-z]/.test(token) && /[A-Z]/.test(token)));
}

/** `text` with every secret it holds replaced with `REDACTED`. */
export function redactString(text: string): string {
  return redactText(text, 0);
}

function redactText(text: string, depth: number): string {
  let out = text.replace(DIGEST_VALUE, (_match, prefix: string) => `${prefix}${REDACTED}`);
  out = out.replace(SCHEME, (match, scheme: string, space: string, token: string) =>
    looksLikeCredential(scheme, token) ? `${scheme}${space}${REDACTED}` : match,
  );
  out = redactJwts(out);
  for (const pattern of PROVIDER_TOKENS) out = out.replace(pattern, REDACTED);
  out = out.replace(URL_PASSWORD, (_match, prefix: string) => `${prefix}${REDACTED}`);
  out = out.replace(AUTH_VALUE, (_match, prefix: string) => `${prefix}${REDACTED}`);
  out = out.replace(
    KEY_VALUE,
    (_match, key: string, separator: string, value: string) =>
      `${key}${separator}${redactedValue(value)}`,
  );
  out = out.replace(CARD, (match) => (passesLuhn(match.replace(/\D/g, '')) ? REDACTED : match));
  out = out.replace(SSN, REDACTED);
  if (depth >= MAX_DECODE_DEPTH) return out;
  return out.replace(ENCODED, (match) => redactEncoded(match, depth));
}

/** Percent-encoded text with the secrets it holds once decoded redacted; unchanged without any. */
function redactEncoded(encoded: string, depth: number): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
  const redacted = redactText(decoded, depth + 1);
  return redacted === decoded ? encoded : encodeURIComponent(redacted);
}

/** The headers with credential headers redacted whole and secrets in the others redacted. */
export function redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = isSensitiveHeader(name) ? REDACTED : redactString(value);
  }
  return out;
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function redactJson(value: Json): Json {
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number') {
    return redactString(String(value)) === String(value) ? value : REDACTED;
  }
  if (Array.isArray(value)) return value.map(redactJson);
  if (typeof value !== 'object' || value === null) return value;
  const out: { [key: string]: Json } = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactJson(inner);
  }
  return out;
}

/**
 * A request, response or WebSocket body with its secrets redacted. JSON stays JSON, with every
 * credential key redacted at any depth: a body without secrets is returned exactly as it was
 * sent, and one with secrets is re-serialized, without its original whitespace. Any other text
 * is redacted as text.
 */
export function redactBody(text: string): string {
  let parsed: Json;
  try {
    parsed = JSON.parse(text) as Json;
  } catch {
    return redactString(text);
  }
  if (typeof parsed !== 'object' || parsed === null) return redactString(text);
  const redacted = JSON.stringify(redactJson(parsed));
  return redacted === JSON.stringify(parsed) ? text : redacted;
}
