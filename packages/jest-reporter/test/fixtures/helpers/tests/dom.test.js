/**
 * @jest-environment jsdom
 */
const { probara } = require('@probara/jest-reporter');

test('works in a jsdom environment', async () => {
  document.body.innerHTML = '<button>Pay</button>';
  probara.parameters({ window: typeof window });
  probara.step('Click Pay', () => {
    document.querySelector('button').click();
  });
  await probara.attach({ name: 'dom.html', body: document.body.innerHTML, contentType: 'text/html' });
});
