import { it } from 'vitest';
import { applyDiscount } from './discount-module-that-is-missing.js';

it('applies the discount', () => {
  applyDiscount(10);
});
