const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { probara } = require('@probara/jest-reporter');

describe('checkout', () => {
  beforeEach(() => {
    probara.parameters({ hook: 'beforeEach' });
  });

  afterEach(() => {
    probara.tags('from-afterEach');
  });

  test('links cases and names the case it creates', () => {
    probara
      .id('SHOP-31')
      .id(['SHOP-32'])
      .title('Pays with a saved card')
      .suite(['Payments', 'Cards'])
      .comment('Paid with visa')
      .tags('smoke')
      .fields({ severity: 'critical', description: 'Pays with a card on file' });
  });

  test('records nested steps, their files and their failures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probara-fixture-'));
    const receipt = join(dir, 'receipt.json');
    writeFileSync(receipt, '{"paid":true}');

    const total = probara.step(
      'Open the cart',
      () => {
        probara.step('Load the items');
        return 3;
      },
      { expected: 'The cart lists 3 items', data: 'sku=42' },
    );
    expect(total).toBe(3);
    await probara.step(
      'Pay',
      async () => {
        await probara.attach({ name: 'receipt', path: receipt });
        await probara.step('Call the bank', () => new Promise((resolve) => setTimeout(resolve, 20)));
      },
      { expected: 'The order is paid' },
    );
    // Deleted after the call: the reporter still sends it.
    rmSync(dir, { recursive: true, force: true });
    await probara.attach({ name: 'log', body: 'paid\n' });
    await probara.attach({
      name: 'bytes',
      body: new Uint8Array([0, 1, 2, 255, 254]),
      contentType: 'application/octet-stream',
    });
    probara.step('Refund', () => {
      expect(1).toBe(2);
    });
  });

  test('is left out with probara.ignore()', () => {
    probara.ignore();
  });
});
