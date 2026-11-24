import { probaraSnap } from '@probara/vitest-reporter';
import { expect, it } from 'vitest';

let tries = 0;

function render(): void {
  document.body.innerHTML = `
    <main style="font-family: sans-serif; height: 1400px">
      <h1>Home</h1>
      <p data-probara-snap-mask>12:00:01</p>
      <p class="clock">12:00:02</p>
      <p class="banner">Sale</p>
    </main>`;
}

it('SHOP-7 renders the home page', async () => {
  render();
  const styles = document.querySelectorAll('style').length;
  await probaraSnap('page');
  await probaraSnap('page-masked', { mask: ['h1'] });
  await probaraSnap('page-whole', {
    fullPage: true,
    threshold: 0.1,
    hide: ['.clock'],
    remove: ['.banner'],
  });
  // The page is as it was once a capture ended: no style, no mask left behind.
  expect(document.querySelectorAll('style').length).toBe(styles);
  expect(document.querySelectorAll('[data-probara-snap-layer]').length).toBe(0);
  expect(getComputedStyle(document.querySelector('.clock') as Element).visibility).toBe('visible');
});

it('uses a name twice', async () => {
  render();
  await probaraSnap('twice');
  await probaraSnap('twice');
});

it('takes its screenshots again when it is retried', { retry: 1 }, async () => {
  tries += 1;
  render();
  await probaraSnap('retried');
  await probaraSnap(tries === 1 ? 'first-only' : 'second-only');
  expect(tries).toBe(2);
});
