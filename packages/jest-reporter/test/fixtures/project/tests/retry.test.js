jest.retryTimes(1);

let attempts = 0;

describe('retries', () => {
  test('is flaky and passes on retry', () => {
    attempts += 1;
    expect(attempts).toBe(2);
  });
});
