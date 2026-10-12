import { probara } from '@probara/vitest-reporter';
import { expect, it } from 'vitest';

// Runs on Node and in the browser: both runs must send the same keys, statuses and helper data (V10).

it('SHOP-41 totals the cart', async () => {
  probara
    .title('Totals the cart')
    .comment('Runs in both modes')
    .parameters({ region: 'eu' })
    .tags('smoke')
    .link('https://ci.example.com/build/7', 'Build');
  probara.step('Add the item', () => undefined, { expected: 'One item in the cart' });
  await probara.attach({ name: 'note', body: 'hello from the test' });
  await probara.attach({ name: 'receipt', path: 'files/receipt.txt' });
});

let attempts = 0;

it('retries the check until it passes', { retry: 1 }, () => {
  attempts += 1;
  expect(attempts).toBeGreaterThan(1);
});
