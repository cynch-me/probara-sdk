jest.retryTimes(1);

let attempts = 0;

describe('output', () => {
  beforeEach(() => {
    console.log('Before each');
  });

  test('prints what it does', () => {
    console.log('Opening the cart');
    console.info('%d items', 3);
    console.error('Slow response: 2.1 s');
    console.warn('Retrying');
  });

  test('prints nothing of its own', () => {});

  test('fails first, then passes', () => {
    attempts += 1;
    console.log(`Attempt ${attempts}`);
    expect(attempts).toBe(2);
  });

  test('silences the console with a spy', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    console.log('Silenced');
    spy.mockRestore();
    console.error('After the spy');
  });
});

test('prints outside any describe', () => {
  console.debug({ sku: 42 });
});

test.concurrent('runs at once', async () => {
  console.log('Concurrent');
});
