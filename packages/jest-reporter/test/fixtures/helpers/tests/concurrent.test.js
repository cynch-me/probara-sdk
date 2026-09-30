const { probara } = require('@probara/jest-reporter');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Each test speaks before and after the other one does.
describe('concurrent', () => {
  test.concurrent('slow', async () => {
    probara.parameters({ who: 'slow' });
    await sleep(60);
    probara.comment('slow');
    await probara.step('slow step', () => sleep(5));
  });

  test.concurrent('fast', async () => {
    probara.parameters({ who: 'fast' });
    await sleep(10);
    probara.comment('fast');
    await probara.step('fast step', () => sleep(5));
  });
});
