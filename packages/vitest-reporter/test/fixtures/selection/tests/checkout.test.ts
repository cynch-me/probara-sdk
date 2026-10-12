import { appendFileSync } from 'node:fs';
import { describe, it } from 'vitest';

/** Writes the label of a body that ran: the bodies that run are the tests of the run's cases. */
function ran(label: string): void {
  appendFileSync('ran.txt', `${label}\n`);
}

describe('checkout', () => {
  it('SHOP-1 pays with a card', () => {
    ran('SHOP-1 pays with a card');
  });

  it('applies the coupon', () => {
    ran('applies the coupon');
  });

  it('is not in the run', () => {
    ran('is not in the run');
  });

  it('SHOP-9 is not in the run', () => {
    ran('SHOP-9 is not in the run');
  });
});

describe('SHOP-3 refunds', () => {
  it('issues the refund', () => {
    ran('issues the refund');
  });
});
