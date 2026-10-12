import { it } from 'vitest';

// An error thrown after the test ends is not any test's failure: Vitest reports it as unhandled.
it('starts a timer that throws later', () => {
  setTimeout(() => {
    throw new Error('the timer failed after the test ended');
  }, 0);
});
