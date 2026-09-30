jest.retryTimes(1);

let attempts = 0;

describe('retries', () => {
  test('is flaky and passes on retry', async () => {
    attempts += 1;
    // Each attempt takes a while: the retry starts well after the first attempt did.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(attempts).toBe(2);
  });
});
