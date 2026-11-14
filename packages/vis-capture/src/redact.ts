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
];

/** Short key names that mark a credential only as the whole key. */
const WHOLE_KEYS = ['pass', 'pwd', 'auth', 'ssn', 'cvv', 'cvc', 'pin', 'session', 'sid'];

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
/** Three base64url segments, the first a JSON object: a JWT. */
const JWT = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;
/** Well-known provider token prefixes (payment, source hosting, cloud and chat keys). */
const PROVIDER_TOKENS = [
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
];
/**
 * The start of a run of key characters. A key is only looked for from there, which keeps the scan
 * of a long unbroken run (a hex dump, a base64url blob) linear.
 */
const RUN_START = '(?<![A-Za-z0-9_.-])';
/** A credential key: one holding a credential part anywhere, or a short credential name. */
const KEY = `${RUN_START}[A-Za-z0-9_.-]*(?:${KEY_PARTS.join('|')})[A-Za-z0-9_.-]*|\\b(?:${WHOLE_KEYS.join('|')})\\b`;
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
  `((?:${RUN_START}[A-Za-z0-9_.-]*authorization[A-Za-z0-9_.-]*|\\bauth\\b)\\s*[:=]\\s*)` +
    `(?!${KNOWN_SCHEME})[A-Za-z][A-Za-z0-9_-]*[ \\t]+${BARE}`,
  'gi',
);

/** What a matched credential value becomes: its quotes and a known auth scheme stay readable. */
function redactedValue(value: string): string {
  const open = /^(?:\\"|["'])/.exec(value)?.[0] ?? '';
  const closed = open !== '' && value.endsWith(open);
  const scheme = LEADING_SCHEME.exec(value.slice(open.length))?.[0] ?? '';
  return `${open}${scheme}${REDACTED}${closed ? open : ''}`;
}
/** The password of `scheme://user:password@host`. */
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@?#]*:)[^\s/@?#]+(?=@)/gi;
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
  let out = text.replace(SCHEME, (match, scheme: string, space: string, token: string) =>
    looksLikeCredential(scheme, token) ? `${scheme}${space}${REDACTED}` : match,
  );
  out = out.replace(JWT, REDACTED);
  for (const pattern of PROVIDER_TOKENS) out = out.replace(pattern, REDACTED);
  out = out.replace(URL_PASSWORD, (_match, prefix: string) => `${prefix}${REDACTED}`);
  out = out.replace(AUTH_VALUE, (_match, prefix: string) => `${prefix}${REDACTED}`);
  out = out.replace(
    KEY_VALUE,
    (_match, key: string, separator: string, value: string) =>
      `${key}${separator}${redactedValue(value)}`,
  );
  out = out.replace(CARD, (match) => (passesLuhn(match.replace(/\D/g, '')) ? REDACTED : match));
  return out.replace(SSN, REDACTED);
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
