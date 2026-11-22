// Screenshots for Probara Snap, taken from a stand-in page (CI has no browser): what the page
// renders is the PNG signature and one byte, so every screenshot is a file of its own.
import { expect, test } from '@playwright/test';
import { probaraSnap } from '@probara/playwright-reporter';

function pageOf(seed) {
  return {
    evaluate: async () => false,
    addStyleTag: async () => ({ evaluate: async () => undefined }),
    locator: (selector) => ({ selector }),
    screenshot: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]),
    viewportSize: () => ({ width: 1280, height: 720 }),
    context: () => ({ browser: () => ({ browserType: () => ({ name: () => 'chromium' }) }) }),
  };
}

test.describe('pages', () => {
  test('PRB-7 home', async () => {
    await probaraSnap(pageOf(1), 'home');
    await probaraSnap(pageOf(2), 'home-menu', { threshold: 0.1 });
  });

  test('cart, on its second attempt', async ({}, testInfo) => {
    await probaraSnap(pageOf(10 + testInfo.retry), 'cart');
    expect(testInfo.retry).toBe(1);
  });

  test('a name used twice', async () => {
    await probaraSnap(pageOf(20), 'twice');
    await probaraSnap(pageOf(21), 'twice');
  });

  test('a failure with its own screenshot', async ({}, testInfo) => {
    await testInfo.attach('screenshot', {
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 99]),
      contentType: 'image/png',
    });
    await probaraSnap(pageOf(30 + testInfo.retry), 'broken');
    expect(1).toBe(2);
  });
});
