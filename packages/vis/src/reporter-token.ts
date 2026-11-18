/**
 * `@probara/vis/reporter-token`: signs the token of a verified reporter on the customer's backend.
 * A compact HS256 JWS whose key is the UTF-8 bytes of the widget's whole signing secret
 * (`pvs_...`), whose audience (`aud`) is the widget and whose key ID (`kid`) is the secret's
 * version, both read from the secret. Web Crypto only: Node 20 or later, Deno, Bun and Workers.
 * Never use it in the browser: the secret must stay on the server.
 */

/** The longest a reporter token may live, and how long it lives unless told otherwise. */
export const REPORTER_TOKEN_MAX_EXPIRY_SECONDS = 3600;

/** What a reporter token says about the reporter; every field is optional. */
export interface ReporterClaims {
  /** The reporter's ID in the customer's app, 1 to 200 characters. */
  sub?: string;
  /** The reporter's name, 1 to 200 characters. */
  name?: string;
  /** The reporter's email address. */
  email?: string;
  /**
   * Flat signed attributes, such as the tenant, store or role: at most 20 keys of 1 to 64
   * characters; each value a string up to 200 characters, a finite number or a boolean.
   */
  attributes?: Readonly<Record<string, string | number | boolean>>;
  /** Seconds until the token expires: 1 to 3,600, 3,600 unless given. */
  expiresInSeconds?: number;
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT = 200;
const MAX_ATTRIBUTES = 20;
const MAX_ATTRIBUTE_KEY = 64;
const MAX_EMAIL = 254;

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array {
  if (!/^[\w-]*$/.test(text)) throw new TypeError('not base64url');
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const utf8 = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

/** The widget ULID and secret version a signing secret names; throws a `TypeError` otherwise. */
function readSecret(secret: unknown): { widget: string; version: number } {
  const refused = new TypeError(
    'signReporterToken: the secret is not a Probara Vis widget signing secret (pvs_...)',
  );
  if (typeof secret !== 'string' || !secret.startsWith('pvs_')) throw refused;
  const [payloadPart = '', signature, ...rest] = secret.slice(4).split('.');
  if (payloadPart === '' || signature === undefined || signature === '' || rest.length > 0)
    throw refused;
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(fromBase64url(payloadPart)),
    );
  } catch {
    throw refused;
  }
  if (
    !isFields(payload) ||
    payload['v'] !== 1 ||
    payload['p'] !== 'vis-widget-signing' ||
    typeof payload['o'] !== 'string' ||
    !ULID.test(payload['o']) ||
    typeof payload['w'] !== 'string' ||
    !ULID.test(payload['w']) ||
    typeof payload['n'] !== 'number' ||
    !Number.isSafeInteger(payload['n']) ||
    payload['n'] < 1
  ) {
    throw refused;
  }
  return { widget: payload['w'], version: payload['n'] };
}

function text(name: string, value: unknown, max = MAX_TEXT): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw new TypeError(
      `signReporterToken: ${name} must be a string of 1 to ${String(max)} characters`,
    );
  }
  return value;
}

function attributesOf(value: unknown): Record<string, string | number | boolean> {
  const refused = (why: string) => new TypeError(`signReporterToken: attributes ${why}`);
  if (!isFields(value)) throw refused('must be a flat object');
  const entries = Object.entries(value);
  if (entries.length > MAX_ATTRIBUTES)
    throw refused(`may hold at most ${String(MAX_ATTRIBUTES)} keys`);
  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, item] of entries) {
    if (key.length < 1 || key.length > MAX_ATTRIBUTE_KEY)
      throw refused(`keys must be 1 to ${String(MAX_ATTRIBUTE_KEY)} characters`);
    const valid =
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item)) ||
      (typeof item === 'string' && item.length <= MAX_TEXT);
    if (!valid)
      throw refused(
        `values must be strings up to ${String(MAX_TEXT)} characters, finite numbers or booleans`,
      );
    attributes[key] = item;
  }
  return attributes;
}

/**
 * Signs the token of a verified reporter with the widget's signing secret, for the page to give
 * the reporter (`createReporter`'s `reporterToken`). Expires in `expiresInSeconds` (at most one
 * hour, one hour unless given). With no claims, the token still verifies the report (a page
 * before login). Rejects with a `TypeError`, which never names the secret, when the secret is
 * not a signing secret or a claim is outside the contract.
 */
export async function signReporterToken(
  secret: string,
  claims: ReporterClaims = {},
): Promise<string> {
  const { widget, version } = readSecret(secret);
  if (!isFields(claims)) throw new TypeError('signReporterToken: claims must be an object');
  const expiresIn: unknown = claims.expiresInSeconds ?? REPORTER_TOKEN_MAX_EXPIRY_SECONDS;
  if (
    typeof expiresIn !== 'number' ||
    !Number.isInteger(expiresIn) ||
    expiresIn < 1 ||
    expiresIn > REPORTER_TOKEN_MAX_EXPIRY_SECONDS
  ) {
    throw new TypeError(
      `signReporterToken: expiresInSeconds must be a whole number from 1 to ${String(REPORTER_TOKEN_MAX_EXPIRY_SECONDS)}`,
    );
  }
  const iat = Math.floor(Date.now() / 1000);
  const payload: Fields = { aud: widget, iat, exp: iat + expiresIn };
  if (claims.sub !== undefined) payload['sub'] = text('sub', claims.sub);
  if (claims.name !== undefined) payload['name'] = text('name', claims.name);
  if (claims.email !== undefined) {
    const email = text('email', claims.email, MAX_EMAIL);
    if (!EMAIL.test(email))
      throw new TypeError('signReporterToken: email must be an email address');
    payload['email'] = email;
  }
  if (claims.attributes !== undefined) payload['attributes'] = attributesOf(claims.attributes);

  const header = { alg: 'HS256', typ: 'JWT', kid: String(version) };
  const signingInput = `${base64url(utf8(JSON.stringify(header)))}.${base64url(utf8(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, utf8(signingInput));
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}
