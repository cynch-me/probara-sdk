// @ts-check
const path = require('node:path');
const { test, expect } = require('@playwright/test');

// No `page` fixture anywhere: these tests never launch a browser.
test.describe('login', () => {
  test('PRB-12 logs in with a valid password', async () => {
    expect(1 + 1).toBe(2);
  });

  test('rejects a wrong password', async () => {
    expect('denied').toBe('granted');
  });

  test('crashes on an unexpected exception', async () => {
    throw new TypeError('Cannot read properties of undefined (reading "token")');
  });

  test('supports SSO', async () => {
    test.skip(true, 'SSO provider not configured');
  });

  test.describe('session', () => {
    test.describe('refresh', () => {
      test('renews the token before expiry', async () => {
        expect([1, 2]).toHaveLength(2);
      });
    });
  });

  for (const [name, length] of [['alice', 5], ['bob', 3]]) {
    test(`username ${name} has length ${length}`, async () => {
      expect(name).toHaveLength(length);
    });
  }

  test('records a probara case annotation', {
    annotation: { type: 'issue', description: 'https://example.com/issues/42' },
    tag: '@smoke',
  }, async () => {
    test.info().annotations.push({ type: 'probara_case', description: 'PRB-13' });
    expect(true).toBe(true);
  });

  test('attaches a file and a body', async ({}, testInfo) => {
    await testInfo.attach('screenshot', { path: path.join(__dirname, '..', 'assets', 'pixel.png'), contentType: 'image/png' });
    await testInfo.attach('server-log', { path: path.join(__dirname, '..', 'assets', 'server.log.txt'), contentType: 'text/plain' });
    await testInfo.attach('note', { body: 'inline body attachment', contentType: 'text/plain' });
    expect(true).toBe(true);
  });

  test('prints to stdout and stderr', async () => {
    console.log('hello from stdout');
    console.error('hello from stderr');
    process.stdout.write('raw stdout line\n');
    process.stderr.write('raw stderr line\n');
  });

  test('accepts café and ñandú', async () => {
    expect('café ñandú').toContain('ñandú');
  });

  test('is flaky and passes on retry', async ({}, testInfo) => {
    expect(testInfo.retry).toBe(1);
  });
});

test('[PRB-14] top-level test outside any describe', async () => {
  expect(true).toBe(true);
});
