import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { probara } from '@probara/playwright-reporter';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');

test.describe('checkout', () => {
  test.beforeEach(async () => {
    await test.step(probara.step('Log in', 'The dashboard shows', 'user=admin'), async () => {});
  });

  test.afterEach(() => {
    // A hook without a test.step is left out of the steps.
  });

  test('reports its steps, their files and the case it creates', async () => {
    probara.parameters({ browser: 'chromium', retries: 0 });
    probara.tags('smoke', 'payments');
    probara.fields({ description: 'Pays with a saved card', priority: 'high', Sevrity: 'critical' });
    await test.step(probara.step('Open the cart', 'It lists 1 item', 'sku=42'), async () => {
      await test.step('Check the total', async () => {
        expect(1).toBe(1);
        await probara.attach({ name: 'cart', body: '{"items":1}', contentType: 'application/json' });
      });
    });
    await test.step(probara.step('Pay'), async () => {
      await probara.attach({ name: 'pixel', path: path.join(assets, 'pixel.png') });
    });
    await probara.attach({ name: 'receipt', body: 'paid', contentType: 'text/plain' });
  });

  test('fails in a step', async () => {
    await test.step('Submit', async () => {
      expect(1).toBe(2);
    });
  });

  test('skips a step', async () => {
    // test.step.skip() exists since Playwright 1.50.
    if (test.step.skip !== undefined) await test.step.skip('Not yet', async () => {});
    await test.step('Done', async () => {});
  });
});
