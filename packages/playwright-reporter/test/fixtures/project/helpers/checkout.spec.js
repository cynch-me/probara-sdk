import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { probara } from '@probara/playwright-reporter';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');

test.describe('checkout', () => {
  test.beforeEach(() => {
    probara.tags('from-hook').parameters({ hook: 'beforeEach' });
  });

  test.afterEach(() => {
    // The last call wins: this comment replaces the one of the test body.
    probara.comment(`after attempt ${test.info().retry}`);
  });

  test('links cases and names the case it creates', () => {
    probara.id('PRB-31').id(['PRB-32']);
    probara.title('Pays with a saved card').suite(['Payments', 'Cards']);
    probara.fields({ severity: 'critical', priority: 'high' });
  });

  test('comments before the error of every attempt', () => {
    probara.comment('replaced by the hook');
    expect(1).toBe(2);
  });

  test('ignores its first attempt only', () => {
    if (test.info().retry === 0) {
      probara.ignore();
      expect(1).toBe(2);
    }
  });

  test('declares case steps and attaches files', async () => {
    await test.step(probara.step('Open the cart', 'The cart lists 1 item', 'sku=42'), async () => {
      await probara.attach({ name: 'cart', body: '{"items":1}', contentType: 'application/json' });
    });
    await test.step('A plain step', async () => {});
    await probara.attach({ name: 'pixel', path: path.join(assets, 'pixel.png') });
  });

  test('is skipped with a reason', () => {
    test.skip(true, 'Not on this plan');
  });
});
