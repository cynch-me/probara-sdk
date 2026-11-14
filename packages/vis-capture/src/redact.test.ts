import { describe, expect, it } from 'vitest';
import { REDACTED, redactBody, redactHeaders, redactString } from './redact.js';

/** About 19 characters per repeat: a run of 190,000 characters. */
const RUN_REPEATS = 10_000;
/** The length of each degenerate input of the linear-time test. */
const LINEAR_LENGTH = 64_000;

describe('built-in redaction', () => {
  it('uses the literal PROBARA_REDACTED', () => {
    expect(REDACTED).toBe('PROBARA_REDACTED');
  });

  it('redacts a JSON key whose last bracketed name is a short credential name', () => {
    expect(
      JSON.parse(
        redactBody(
          '{"user[pass]":"v1","user[pwd]":"v2","card[cvv]":"v3","card%5Bpin%5D":"v4","a[b][auth]":"v5","user[pass][]":["v6"],"user[name]":"ana","page[number]":2,"pin[label]":"door"}',
        ),
      ),
    ).toEqual({
      'user[pass]': 'PROBARA_REDACTED',
      'user[pwd]': 'PROBARA_REDACTED',
      'card[cvv]': 'PROBARA_REDACTED',
      'card%5Bpin%5D': 'PROBARA_REDACTED',
      'a[b][auth]': 'PROBARA_REDACTED',
      'user[pass][]': 'PROBARA_REDACTED',
      'user[name]': 'ana',
      'page[number]': 2,
      'pin[label]': 'door',
    });
  });

  it('redacts a JWT glued to a dash or an underscore, or after other dotted segments', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlX2hlcmU';
    expect(redactString(`id-${jwt} done`)).toBe('id-PROBARA_REDACTED done');
    expect(redactString(`id_${jwt} done`)).toBe('id_PROBARA_REDACTED done');
    expect(redactString(`release.candidate.${jwt}`)).toBe('release.candidate.PROBARA_REDACTED');
    expect(redactString('monkeyJumps.example.domain')).toBe('monkeyJumps.example.domain');
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

  it('redacts every parameter of a Digest Authorization line', () => {
    const line =
      'Authorization: Digest username="ana", realm="shop", response="6629fae49393a05397450978507c4ef1"';
    expect(redactString(`${line}\nnext line`)).toBe(
      'Authorization: Digest PROBARA_REDACTED\nnext line',
    );
  });

  it('redacts the Digest scheme like Bearer and Basic', () => {
    expect(redactString('Authorization: Digest dXNlcjpwYXNzd29yZA==')).toBe(
      'Authorization: Digest PROBARA_REDACTED',
    );
    expect(redactString('retrying with digest a1b2c3d4e5f6 now')).toBe(
      'retrying with digest PROBARA_REDACTED now',
    );
  });

  it('redacts each well-known provider token wherever it appears', () => {
    const tokens = [
      'sk_live_4eC39HqLyjWDarjtT1zdp7dc',
      'sk_test_4eC39HqLyjWDarjtT1zdp7dc',
      'rk_live_51H8abcdEFGH1234',
      'pk_test_TYooMQauvdEDq54NiTphI7jx',
      'ghp_16C7e42F292c6912E7710c838347Ae178B4a',
      'gho_16C7e42F292c6912E7710c838347Ae178B4a',
      'ghu_16C7e42F292c6912E7710c838347Ae178B4a',
      'ghs_16C7e42F292c6912E7710c838347Ae178B4a',
      'ghr_16C7e42F292c6912E7710c838347Ae178B4a',
      'AKIAIOSFODNN7EXAMPLE',
      'xoxb-17653672481-19874698323-pdFZKVeTuE8sk7oOcBrzbqgy',
      'xoxa-2-17653672481-19874698323',
      'xoxp-17653672481-19874698323-pdFZKVeTuE8',
      'xoxr-17653672481-19874698323-pdFZKVeTuE8',
    ];
    expect(tokens.map((token) => redactString(`using ${token} here`))).toEqual(
      tokens.map(() => 'using PROBARA_REDACTED here'),
    );
  });

  it('keeps words that only start like a provider token', () => {
    const texts = ['sk_live_short', 'ghp_tooShort', 'AKIA1234', 'xoxb-short'];
    expect(texts.map(redactString)).toEqual(texts);
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
    // Whatever is glued in front of the scheme.
    expect(redactString('curl -xhttp://ana:s3cret@proxy.test:8080 https://shop.test')).toBe(
      'curl -xhttp://ana:PROBARA_REDACTED@proxy.test:8080 https://shop.test',
    );
    expect(redactString('…cache.redis://ana:pw123456@db.test/0')).toBe(
      '…cache.redis://ana:PROBARA_REDACTED@db.test/0',
    );
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

  it('redacts form fields with bracketed names, nested and percent-encoded', () => {
    expect(redactString('user[password]=fdPWcore1')).toBe('user[password]=PROBARA_REDACTED');
    expect(redactString('user%5Bpassword%5D=railsPWcore1')).toBe(
      'user%5Bpassword%5D=PROBARA_REDACTED',
    );
    expect(redactString('user[password]=bracketPWcore1&user[api_key]=bracketKEYcore2')).toBe(
      'user[password]=PROBARA_REDACTED&user[api_key]=PROBARA_REDACTED',
    );
    expect(
      redactString('a[b][token]=n1&a%5Bb%5D%5Btoken%5D=n2&user[pass]=n3&user%5Bpwd%5D=n4'),
    ).toBe(
      'a[b][token]=PROBARA_REDACTED&a%5Bb%5D%5Btoken%5D=PROBARA_REDACTED' +
        '&user[pass]=PROBARA_REDACTED&user%5Bpwd%5D=PROBARA_REDACTED',
    );
    const plain = 'page[number]=2&user[name]=ana&filter%5Bstatus%5D=open';
    expect(redactString(plain)).toBe(plain);
  });

  it('redacts the keys of more providers when they appear bare in text', () => {
    const tokens = [
      'github_pat_11ABCDEFG0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789aBcDeFgHiJkLmNoPqRsTuVwXyZ01234567',
      'sk-proj-AbCdEf0123456789_AbCdEf0123456789-xyz',
      'sk-ant-api03-AbCdEf0123456789_AbCdEf0123456789-xyzAA',
      'AIzaSyD-0123456789abcdefghijklmnopqrstu',
      'glpat-AbCdEf0123456789xyzA',
      'npm_AbCdEf0123456789AbCdEf0123456789AbCd',
      'SG.AbCdEf0123456789AbCdEf.AbCdEf0123456789AbCdEf0123456789AbCdEf01234',
    ];
    expect(tokens.map((token) => redactString(`using ${token} here`))).toEqual(
      tokens.map(() => 'using PROBARA_REDACTED here'),
    );
  });

  it('keeps ordinary words and short strings that start like those provider keys', () => {
    const texts = [
      'github_pat_short',
      'sk-proj-short and sk-ant-short',
      'AIzaShort, and AIza0123456789012345678901234567890123 (34 after the prefix)',
      'glpat-short',
      'run npm_install, read npm_config_cache',
      'SG.short.words',
    ];
    expect(texts.map(redactString)).toEqual(texts);
  });

  it('redacts the session cookies of common frameworks in cookie strings', () => {
    expect(
      redactString(
        'PHPSESSID=php1; laravel_session=lar2; connect.sid=s%3Aexp3; JSESSIONID=j4; ' +
          'ASP.NET_SessionId=asp5; theme=dark',
      ),
    ).toBe(
      'PHPSESSID=PROBARA_REDACTED; laravel_session=PROBARA_REDACTED; ' +
        'connect.sid=PROBARA_REDACTED; JSESSIONID=PROBARA_REDACTED; ' +
        'ASP.NET_SessionId=PROBARA_REDACTED; theme=dark',
    );
    expect(redactString('_shop_session=rails6; sessions=3')).toBe(
      '_shop_session=PROBARA_REDACTED; sessions=3',
    );
  });

  it('redacts the signatures and credentials of signed URLs and of an AWS SigV4 line', () => {
    expect(
      redactString(
        'https://b.s3.amazonaws.com/k.png?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
          '&X-Amz-Credential=AKIDEXAMPLE%2F20261113%2Fus-east-1%2Fs3%2Faws4_request' +
          '&X-Amz-Date=20261113T000000Z&X-Amz-Expires=900&X-Amz-Security-Token=FwoGZXIvYXdzEJr' +
          '&X-Amz-SignedHeaders=host&X-Amz-Signature=fe5f80f77d5fa3beca038a248ff027d0',
      ),
    ).toBe(
      'https://b.s3.amazonaws.com/k.png?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=PROBARA_REDACTED' +
        '&X-Amz-Date=20261113T000000Z&X-Amz-Expires=900&X-Amz-Security-Token=PROBARA_REDACTED' +
        '&X-Amz-SignedHeaders=host&X-Amz-Signature=PROBARA_REDACTED',
    );
    expect(
      redactString('https://a.blob.core.windows.net/c/f?sv=2022&se=2026&sig=abc%2Bdef%3D'),
    ).toBe('https://a.blob.core.windows.net/c/f?sv=2022&se=2026&sig=PROBARA_REDACTED');
    expect(redactString('https://cdn.test/f.mp4?signature=0a1b2c&expires=9')).toBe(
      'https://cdn.test/f.mp4?signature=PROBARA_REDACTED&expires=9',
    );
    expect(
      redactString(
        'Authorization: AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261113/us-east-1/s3/aws4_request, ' +
          'SignedHeaders=host;x-amz-date, Signature=fe5f80f77d5fa3beca038a248ff027d0',
      ),
    ).toBe(
      'Authorization: PROBARA_REDACTED, SignedHeaders=host;x-amz-date, Signature=PROBARA_REDACTED',
    );
    expect(
      redactString(
        'signing AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261113/us-east-1/s3/aws4_request, ' +
          'SignedHeaders=host, Signature=fe5f80f77d5fa3beca038a248ff027d0',
      ),
    ).toBe(
      'signing AWS4-HMAC-SHA256 Credential=PROBARA_REDACTED, SignedHeaders=host, ' +
        'Signature=PROBARA_REDACTED',
    );
  });

  it('redacts credential keys in percent-encoded JSON of a query string', () => {
    expect(
      redactString(
        'https://api.test/graphql?operationName=Login' +
          '&variables=%7B%22token%22%3A%22enc-secret-1%22%2C%22page%22%3A2%7D',
      ),
    ).toBe(
      'https://api.test/graphql?operationName=Login' +
        '&variables=%7B%22token%22%3A%22PROBARA_REDACTED%22%2C%22page%22%3A2%7D',
    );
    const plain = 'https://api.test/graphql?variables=%7B%22page%22%3A2%7D&bad=%E0%A4%A';
    expect(redactString(plain)).toBe(plain);
  });

  it('stays linear on degenerate input: a repeated key, token prefix or URL scheme', () => {
    const units = [
      'token',
      'password',
      'authorization',
      'eyJ-',
      'a.',
      'a-',
      'SG.',
      'sk-proj-',
      'pass.',
    ];
    const slow = units.flatMap((unit) => {
      const text = unit.repeat(Math.ceil(LINEAR_LENGTH / unit.length));
      const started = performance.now();
      redactString(text);
      const ms = performance.now() - started;
      return ms < 250 ? [] : [`${unit}: ${String(Math.round(ms))} ms`];
    });
    expect(slow).toEqual([]);
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
