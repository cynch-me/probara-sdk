import { probara } from '@probara/vitest-reporter';
import { expect, it } from 'vitest';

// Outside a test: one warning, and nothing is recorded.
probara.title('Set up outside a test');

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

it('records the title, suite, comment, parameters, a link and an issue', () => {
  probara
    .title('Checkout total')
    .suite(['Payments', 'Cards'])
    .comment('Runs on staging only')
    .parameters({ region: 'eu' })
    .link('https://ci.example.com/build/12', 'Build')
    .issue('SHOP-7');
});

it('checks the total SHOP-40', () => {
  probara.id('SHOP-41');
});

it('is left out of the report when it ignores itself', () => {
  probara.ignore();
});

it('gives the case it creates its tags and fields, and nothing else', () => {
  probara
    .tags('smoke', 'payments')
    .fields({ priority: 'high', description: 'Sums the cart' });
});

it('gives the case it creates the native tags of Vitest 4.1 and later too', { tags: ['regression'] }, () => {
  probara.tags('smoke');
});

it('nests the steps it runs, and gives the case the outermost ones, with their expected results and data', () => {
  probara.step(
    'Open the cart',
    () => {
      probara.step('Add the item', () => undefined, {
        expected: 'One item in the cart',
        data: 'SKU-1',
      });
    },
    { expected: 'The cart is open' },
  );
});

it('reports a step its test never waited for as unfinished', () => {
  probara.step('Wait for the email', () => new Promise<void>(() => undefined));
});

it('fails the test with the error of a step that throws', () => {
  probara.step('Submit the form', () => {
    throw new Error('the card was declined');
  });
});

it.concurrent('the first of two concurrent tests', async () => {
  probara.title('First concurrent').parameters({ who: 'first' });
  await delay(20);
  probara.step('First step', () => undefined);
  await delay(20);
  probara.tags('first');
});

it.concurrent('the second of two concurrent tests', async () => {
  probara.title('Second concurrent').parameters({ who: 'second' });
  await delay(10);
  probara.step('Second step', () => undefined);
  await delay(30);
});

it.each([1, 2])('doubles the input %i', (input) => {
  probara.parameters({ input });
});

it('attaches a body while the test runs, and passes', async () => {
  await probara.attach({ name: 'note.txt', body: 'the cart was checked' });
});

it('warns about a wrong argument once, and goes on', () => {
  probara.id(5 as unknown as string);
});

it('runs a step body and returns its value, with or without the reporter', () => {
  expect(probara.step('Calculates', () => 40 + 2)).toBe(42);
});

let attemptOfRouting = 0;

it('routes the helpers of each attempt to that attempt', { retry: 2 }, () => {
  attemptOfRouting += 1;
  probara.step(`Attempt ${attemptOfRouting} step`, () => undefined);
  if (attemptOfRouting < 3) throw new Error(`attempt ${attemptOfRouting} fails`);
});
