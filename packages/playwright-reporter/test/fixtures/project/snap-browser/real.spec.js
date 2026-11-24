// probaraSnap on a real page: what the page looks like while it is captured, and after.
import { expect, test } from '@playwright/test';
import { probaraSnap } from '@probara/playwright-reporter';

const HTML = `
  <style>
    @keyframes spin { to { transform: rotate(360deg); } }
    .spin { animation: spin 1s infinite linear; width: 50px; height: 50px; background: red; }
    .tall { height: 2000px; }
  </style>
  <div class="spin"></div>
  <div class="clock">12:00</div>
  <div class="secret" data-probara-snap-hide>hidden by its attribute</div>
  <div class="banner" style="height: 100px">Cookies</div>
  <div class="avatar" data-probara-snap-mask style="width: 40px; height: 40px"></div>
  <input class="field" />
  <div class="tall"></div>
`;

function stateOf(page) {
  return page.evaluate(() => {
    const styleOf = (selector) => getComputedStyle(document.querySelector(selector));
    return {
      styles: document.querySelectorAll('style').length,
      animation: styleOf('.spin').animationDuration,
      caret: styleOf('.field').caretColor,
      clock: styleOf('.clock').visibility,
      secret: styleOf('.secret').visibility,
      banner: styleOf('.banner').display,
    };
  });
}

test('captures a still page and restores it', async ({ page }) => {
  await page.setContent(HTML);
  await page.locator('.field').focus();
  const before = await stateOf(page);
  const during = [];
  const options = [];
  const screenshot = page.screenshot.bind(page);
  page.screenshot = async (given) => {
    during.push(await stateOf(page));
    options.push(given);
    return screenshot(given);
  };

  await probaraSnap(page, 'viewport');
  await probaraSnap(page, 'full', {
    fullPage: true,
    threshold: 0.05,
    hide: ['.clock'],
    remove: ['.banner'],
    mask: ['.spin'],
  });

  expect(before).toMatchObject({ animation: '1s', clock: 'visible', banner: 'block' });
  expect(during).toEqual([
    {
      styles: before.styles + 1,
      animation: '0s',
      caret: 'rgba(0, 0, 0, 0)',
      clock: 'visible',
      secret: 'hidden',
      banner: 'block',
    },
    {
      styles: before.styles + 1,
      animation: '0s',
      caret: 'rgba(0, 0, 0, 0)',
      clock: 'hidden',
      secret: 'hidden',
      banner: 'none',
    },
  ]);
  expect(options.map((given) => [given.fullPage, given.mask.length])).toEqual([
    [false, 1],
    [true, 2],
  ]);
  expect(await stateOf(page)).toEqual(before);
});
