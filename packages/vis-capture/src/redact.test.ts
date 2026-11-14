import { describe, expect, it } from 'vitest';
import { REDACTED, redactBody, redactHeaders, redactString } from './index.js';

/** About 19 characters per repeat: a run of 190,000 characters. */
const RUN_REPEATS = 10_000;

describe('built-in redaction', () => {
  it('uses the literal PROBARA_REDACTED', () => {
    expect(REDACTED).toBe('PROBARA_REDACTED');
  });

  it('redacts bearer and basic credentials and JWT-looking tokens in text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlX2hlcmU';
    expect(redactString('Authorization: Bearer abc.def-123')).toBe(
      'Authorization: Bearer PROBARA_REDACTED',
    );
    expect(redactString('sent basic dXNlcjpwYXNz to the proxy')).toBe(
      'sent basic PROBARA_REDACTED to the proxy',
    );
    expect(redactString(`token in log ${jwt} end`)).toBe('token in log PROBARA_REDACTED end');
  });

  it('redacts the values of credential-like keys in text and query strings', () => {
    expect(redactString('login failed password=hunter2 user=ana')).toBe(
      'login failed password=PROBARA_REDACTED user=ana',
    );
    expect(redactString('https://a.test/cb?code=1&access_token=xyz&state=s')).toBe(
      'https://a.test/cb?code=1&access_token=PROBARA_REDACTED&state=s',
    );
    expect(redactString('{"apiKey": "k-123", "page": 2}')).toBe(
      '{"apiKey": "PROBARA_REDACTED", "page": 2}',
    );
    expect(redactString('client_secret: s3cr3t')).toBe('client_secret: PROBARA_REDACTED');
  });

  it('redacts a quoted credential whole, spaces and delimiters included', () => {
    expect(redactString('{"password": "correct horse battery", "page": 2}')).toBe(
      '{"password": "PROBARA_REDACTED", "page": 2}',
    );
    expect(redactString("login password='two words' retry=1")).toBe(
      "login password='PROBARA_REDACTED' retry=1",
    );
    expect(redactString('{"client_secret": "a,b;c&d}e]f", "n": 1}')).toBe(
      '{"client_secret": "PROBARA_REDACTED", "n": 1}',
    );
    // A JSON document inside a string keeps its quotes escaped.
    expect(redactString('body {\\"password\\":\\"two words\\",\\"n\\":1}')).toBe(
      'body {\\"password\\":\\"PROBARA_REDACTED\\",\\"n\\":1}',
    );
  });

  it('redacts a quoted credential cut before its closing quote up to the end of the line', () => {
    expect(redactString('{"token": "abc def')).toBe('{"token": "PROBARA_REDACTED');
    expect(redactString('{"token": "abc def\nnext line')).toBe(
      '{"token": "PROBARA_REDACTED\nnext line',
    );
  });

  it('redacts the whole Authorization credential whatever its scheme', () => {
    expect(redactString('Authorization: Token abc123def')).toBe('Authorization: PROBARA_REDACTED');
    expect(redactString('proxy-authorization: ApiKey k-9 sent')).toBe(
      'proxy-authorization: PROBARA_REDACTED sent',
    );
    expect(redactString('auth=Custom zzz&next=1')).toBe('auth=PROBARA_REDACTED&next=1');
    // A known scheme stays readable, with everything after it redacted.
    expect(redactString('Authorization: Basic abc')).toBe('Authorization: Basic PROBARA_REDACTED');
    expect(redactString('Authorization: Bearer abc$def!ghi')).toBe(
      'Authorization: Bearer PROBARA_REDACTED',
    );
    expect(redactString('{"authorization": "Token abc 123"}')).toBe(
      '{"authorization": "PROBARA_REDACTED"}',
    );
  });

  it('keeps an empty credential value as it is', () => {
    expect(redactString('{"password": "", "page": 2}')).toBe('{"password": "", "page": 2}');
  });

  it('redacts the password of a URL that carries its credentials', () => {
    expect(redactString('GET https://ana:hunter2@shop.test/cart?page=2')).toBe(
      'GET https://ana:PROBARA_REDACTED@shop.test/cart?page=2',
    );
    // A port and an at sign elsewhere in the URL are not credentials.
    const plain = 'ws://shop.test:8080/live?mail=ana@shop.test';
    expect(redactString(plain)).toBe(plain);
  });

  it('redacts a card number sent as a JSON number', () => {
    expect(JSON.parse(redactBody('{"pan": 4111111111111111, "qty": 2}'))).toEqual({
      pan: 'PROBARA_REDACTED',
      qty: 2,
    });
    expect(redactBody('4111111111111111')).toBe('PROBARA_REDACTED');
  });

  it('returns a JSON body without secrets exactly as it was sent', () => {
    const body = '{ "id": 9007199254740993, "price": 1.50,\n  "items": [1, 2] }';
    expect(redactBody(body)).toBe(body);
  });

  it('stays fast on a long unbroken run of key characters', () => {
    const blob = 'deadbeef-cafe.0123_'.repeat(RUN_REPEATS);
    const started = performance.now();
    expect(redactString(blob)).toBe(blob);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('redacts card numbers that pass the Luhn check, and SSNs', () => {
    expect(redactString('card 4111 1111 1111 1111 declined')).toBe(
      'card PROBARA_REDACTED declined',
    );
    expect(redactString('card 4111-1111-1111-1111')).toBe('card PROBARA_REDACTED');
    expect(redactString('ssn 123-45-6789 on file')).toBe('ssn PROBARA_REDACTED on file');
    // Not a card: fails the Luhn check (an order number), and kept.
    expect(redactString('order 1234567890123456')).toBe('order 1234567890123456');
  });

  it('keeps text without secrets unchanged', () => {
    const text = 'GET /api/cart 200 in 35 ms, 3 items, total 42.10';
    expect(redactString(text)).toBe(text);
  });

  it('does not take ordinary words, ids and timestamps for secrets', () => {
    const texts = [
      'Basic setup complete',
      'author: Ana, passage=2',
      'saved at 1763000000120 (epoch ms)',
      'order id 9781234567897',
      'tokens left: none',
    ];
    expect(texts.map(redactString)).toEqual([
      'Basic setup complete',
      'author: Ana, passage=2',
      'saved at 1763000000120 (epoch ms)',
      'order id 9781234567897',
      'tokens left: none',
    ]);
  });

  it('redacts authorization and cookie style headers whatever their case', () => {
    expect(
      redactHeaders({
        Authorization: 'Bearer abc',
        cookie: 'sid=1; theme=dark',
        'Set-Cookie': 'sid=2',
        'X-API-Key': 'k',
        'x-csrf-token': 't',
        'content-type': 'application/json',
        'x-request-id': 'r-1',
      }),
    ).toEqual({
      Authorization: 'PROBARA_REDACTED',
      cookie: 'PROBARA_REDACTED',
      'Set-Cookie': 'PROBARA_REDACTED',
      'X-API-Key': 'PROBARA_REDACTED',
      'x-csrf-token': 'PROBARA_REDACTED',
      'content-type': 'application/json',
      'x-request-id': 'r-1',
    });
  });

  it('redacts secrets inside the values of other headers', () => {
    expect(
      redactHeaders({ 'x-forwarded-auth': 'Bearer zzz', referer: 'https://a.test/?token=q' }),
    ).toEqual({
      'x-forwarded-auth': 'PROBARA_REDACTED',
      referer: 'https://a.test/?token=PROBARA_REDACTED',
    });
  });

  it('redacts credential keys at any depth of a JSON body, and keeps it JSON', () => {
    const body = JSON.stringify({
      user: { email: 'ana@shop.test', password: 'hunter2', profile: { ssn: '123-45-6789' } },
      payment: { cardNumber: '4111111111111111', cvv: 123, amount: 10 },
      session_token: { value: 'nested' },
      items: [{ sku: 'A', note: 'Bearer abc' }],
    });
    expect(JSON.parse(redactBody(body))).toEqual({
      user: {
        email: 'ana@shop.test',
        password: 'PROBARA_REDACTED',
        profile: { ssn: 'PROBARA_REDACTED' },
      },
      payment: { cardNumber: 'PROBARA_REDACTED', cvv: 'PROBARA_REDACTED', amount: 10 },
      session_token: 'PROBARA_REDACTED',
      items: [{ sku: 'A', note: 'Bearer PROBARA_REDACTED' }],
    });
  });

  it('redacts a body that is not JSON as text', () => {
    expect(redactBody('grant_type=password&username=ana&password=hunter2')).toBe(
      'grant_type=password&username=ana&password=PROBARA_REDACTED',
    );
  });
});
