import { probaraSnap } from '@probara/vitest-reporter';
import { it } from 'vitest';

it('renders the cart', async () => {
  document.body.innerHTML = '<main style="font-family: sans-serif"><h1>Cart</h1></main>';
  // The same name as a screenshot of another test: each test keeps its own.
  await probaraSnap('page');
});
