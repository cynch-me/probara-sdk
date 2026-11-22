import { probaraSnap } from '@probara/vitest-reporter';
import { it } from 'vitest';

it('calls probaraSnap in Node', async () => {
  await probaraSnap('home');
  await probaraSnap('cart');
});
