const { probara } = require('@probara/jest-reporter');

jest.retryTimes(2);

let attempt = 0;

describe('retries', () => {
  test('passes on the third attempt', () => {
    attempt += 1;
    probara.comment(`attempt ${attempt}`);
    probara.step(`Try ${attempt}`);
    expect(attempt).toBe(3);
  });
});
