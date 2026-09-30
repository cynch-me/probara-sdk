import { describe, expect, it } from 'vitest';
import { REDIRECT_FETCH_URL } from './redirect.js';
import { docsEnvOf, runEnvOf } from './env.js';

describe('docsEnvOf', () => {
  it('is a configured job reporting to the fake, whatever the base URL', () => {
    expect(docsEnvOf({ token: 't', fakeUrl: 'http://127.0.0.1:1', project: 'SHOP' })).toEqual({
      PROBARA_API_TOKEN: 't',
      PROBARA_PROJECT: 'SHOP',
      PROBARA_DOCS_FAKE_URL: 'http://127.0.0.1:1',
      NODE_OPTIONS: `--import=${REDIRECT_FETCH_URL}`,
    });
  });

  it('leaves the project out when none is given, and a variable the extras unset', () => {
    expect(
      docsEnvOf({
        token: 't',
        fakeUrl: 'http://127.0.0.1:1',
        extra: { PROBARA_API_TOKEN: undefined, PROBARA_DEBUG: 'true' },
      }),
    ).toEqual({
      PROBARA_DEBUG: 'true',
      PROBARA_DOCS_FAKE_URL: 'http://127.0.0.1:1',
      NODE_OPTIONS: `--import=${REDIRECT_FETCH_URL}`,
    });
  });

  it('keeps the redirect whatever the extras say', () => {
    const env = docsEnvOf({
      token: 't',
      fakeUrl: 'http://127.0.0.1:1',
      extra: { NODE_OPTIONS: '', PROBARA_DOCS_FAKE_URL: 'https://example.com' },
    });

    expect(env.NODE_OPTIONS).toBe(`--import=${REDIRECT_FETCH_URL}`);
    expect(env.PROBARA_DOCS_FAKE_URL).toBe('http://127.0.0.1:1');
  });
});

describe('runEnvOf', () => {
  const job = docsEnvOf({ token: 't', fakeUrl: 'http://127.0.0.1:1', project: 'SHOP' });

  it("adds a line's variables to the job's", () => {
    expect(runEnvOf([['PROBARA_DEBUG', 'true']], job)).toEqual({ ...job, PROBARA_DEBUG: 'true' });
  });

  it.each([
    'PROBARA_API_TOKEN',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NODE_USE_ENV_PROXY',
    'NODE_EXTRA_CA_CERTS',
    'NODE_USE_SYSTEM_CA',
  ])('leaves out %s: the fake takes only its token, and is no proxy of the network', (name) => {
    expect(runEnvOf([[name, 'x']], job)).toEqual(job);
  });

  it('keeps the redirect and the fake whatever the line sets', () => {
    expect(
      runEnvOf(
        [
          ['NODE_OPTIONS', ''],
          ['PROBARA_DOCS_FAKE_URL', 'https://example.com'],
        ],
        job,
      ),
    ).toEqual(job);
  });
});
