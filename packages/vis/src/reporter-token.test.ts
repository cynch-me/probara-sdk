/**
 * The reporter token helper, as a customer's backend calls it: a compact HS256 JWS whose key is
 * the signing secret's own bytes, its audience and key ID read from the secret.
 */
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPORTER_TOKEN_MAX_EXPIRY_SECONDS, signReporterToken } from './reporter-token.js';

const WIDGET = '01JWXDGET00000000000000000';
const ORG = '01JACME0000000000000000000';

const b64url = (value: string | Buffer): string => Buffer.from(value).toString('base64url');

/** A signing secret as Probara shows it: `pvs_` + payload + "." + a signature. */
function secretFor(
  payload: unknown = { v: 1, p: 'vis-widget-signing', o: ORG, w: WIDGET, n: 3 },
): string {
  return `pvs_${b64url(JSON.stringify(payload))}.${b64url('server-side-signature')}`;
}

function decode(token: string): { header: unknown; claims: unknown } {
  const [header = '', claims = ''] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as unknown,
    claims: JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as unknown,
  };
}

function verifies(token: string, secret: string): boolean {
  const [header = '', claims = '', signature = ''] = token.split('.');
  const expected = createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(`${header}.${claims}`)
    .digest('base64url');
  return signature === expected;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('signReporterToken', () => {
  it('signs an HS256 JWT keyed by the whole secret, with aud and kid from the secret', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_800_000_000_000));
    const secret = secretFor();
    const token = await signReporterToken(secret, {
      sub: 'user-42',
      name: 'Ana López',
      email: 'ana@shop.example',
      attributes: { tenant: 'acme', store: 'north', admin: true, level: 3 },
      expiresInSeconds: 600,
    });
    expect(token.split('.')).toHaveLength(3);
    expect(verifies(token, secret)).toBe(true);
    const { header, claims } = decode(token);
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT', kid: '3' });
    expect(claims).toEqual({
      aud: WIDGET,
      iat: 1_800_000_000,
      exp: 1_800_000_600,
      sub: 'user-42',
      name: 'Ana López',
      email: 'ana@shop.example',
      attributes: { tenant: 'acme', store: 'north', admin: true, level: 3 },
    });
  });

  it('signs a token with no user, expiring in one hour by default', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_800_000_000_500));
    const secret = secretFor({ v: 1, p: 'vis-widget-signing', o: ORG, w: WIDGET, n: 1 });
    const token = await signReporterToken(secret);
    expect(REPORTER_TOKEN_MAX_EXPIRY_SECONDS).toBe(3600);
    expect(verifies(token, secret)).toBe(true);
    expect(decode(token).header).toEqual({ alg: 'HS256', typ: 'JWT', kid: '1' });
    expect(decode(token).claims).toEqual({ aud: WIDGET, iat: 1_800_000_000, exp: 1_800_003_600 });
  });

  it('refuses a secret that is not a signing secret, never naming it', async () => {
    const wrongPurpose = secretFor({ v: 1, p: 'vis-widget-key', o: ORG, w: WIDGET, n: 1 });
    for (const secret of [
      '',
      'pvk_abc.def',
      `pvs_${b64url('not json')}.sig`,
      wrongPurpose,
      secretFor({ v: 2, p: 'vis-widget-signing', o: ORG, w: WIDGET, n: 1 }),
      secretFor({ v: 1, p: 'vis-widget-signing', o: ORG, w: 'not-a-ulid', n: 1 }),
      secretFor({ v: 1, p: 'vis-widget-signing', o: ORG, w: WIDGET, n: 0 }),
      secretFor({ v: 1, p: 'vis-widget-signing', o: ORG, w: WIDGET, n: 1.5 }),
      42 as unknown as string,
    ]) {
      const error: unknown = await signReporterToken(secret).catch((caught: unknown) => caught);
      expect(error, JSON.stringify(secret)).toBeInstanceOf(TypeError);
      if (typeof secret === 'string' && secret.length > 4)
        expect((error as Error).message).not.toContain(secret.slice(4));
    }
  });

  it('refuses claims outside the contract', async () => {
    const secret = secretFor();
    const invalid: unknown[] = [
      { sub: '' },
      { sub: 'x'.repeat(201) },
      { name: '' },
      { name: 'x'.repeat(201) },
      { email: 'not-an-email' },
      { attributes: [] },
      { attributes: { nested: { a: 1 } } },
      { attributes: { '': 'empty key' } },
      { attributes: { ['k'.repeat(65)]: 'long key' } },
      { attributes: { long: 'v'.repeat(201) } },
      { attributes: { nan: Number.NaN } },
      {
        attributes: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${String(i)}`, i])),
      },
      { expiresInSeconds: 0 },
      { expiresInSeconds: 3601 },
      { expiresInSeconds: 10.5 },
    ];
    for (const claims of invalid) {
      await expect(
        signReporterToken(secret, claims as Parameters<typeof signReporterToken>[1]),
        JSON.stringify(claims),
      ).rejects.toBeInstanceOf(TypeError);
    }
    await expect(
      signReporterToken(secret, {
        sub: 'x'.repeat(200),
        attributes: Object.fromEntries(
          Array.from({ length: 20 }, (_, i) => [`k${String(i)}`, 'v'.repeat(200)]),
        ),
        expiresInSeconds: 3600,
      }),
    ).resolves.toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });
});
