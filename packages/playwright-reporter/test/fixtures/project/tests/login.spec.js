import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');

test.describe('login', () => {
  test('PRB-12 logs in with a valid password', () => {
    expect(1 + 1).toBe(2);
  });

  test('rejects a wrong password', () => {
    expect('denied').toBe('granted');
  });

  test('supports SSO', () => {
    test.skip(true, 'SSO provider not configured');
  });

  test.fixme('remembers the device', () => {});

  test('is a known bug', () => {
    test.fail();
    expect(1).toBe(2);
  });

  test('was fixed but is still marked as failing', () => {
    test.fail();
    expect(1).toBe(1);
  });

  test('times out', async () => {
    test.setTimeout(200);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  test('is flaky and passes on retry', () => {
    expect(test.info().retry).toBe(1);
  });

  test(
    'records probara case annotations',
    { annotation: { type: 'probara_case', description: 'PRB-13, PRB-14' } },
    () => {},
  );

  test('adds a probara case annotation at runtime', () => {
    test.info().annotations.push({ type: 'probara_case', description: 'PRB-15' });
  });

  test.describe('session', () => {
    test.describe('refresh', () => {
      test('[PRB-16] renews the token (@PRB-17)', () => {});
    });
  });

  test('attaches a file and a body', async () => {
    await test.info().attach('pixel', {
      path: path.join(assets, 'pixel.png'),
      contentType: 'image/png',
    });
    await test.info().attach('data', { body: '{"cart":3}', contentType: 'application/json' });
  });

  test('prints to stdout and stderr', () => {
    console.log('hello from stdout');
    console.error('hello from stderr');
  });
});

test('top-level test outside any describe', () => {});
