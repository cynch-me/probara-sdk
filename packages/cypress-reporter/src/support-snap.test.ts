/**
 * `cy.probaraSnap` in the browser, with a fake `cy`/`Cypress`: what it asks Cypress to capture, how it holds the
 * page still, and the two files of the attempt it hands the plugin. The real thing is proven by
 * `test/cypress-snap.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { installSupport } from './support-api.js';
import { fakeBrowser, settingsOf, type FakeBrowser } from '../test/support/browser-fakes.js';

const SPEC = 'cypress/e2e/cart.cy.js';
const TEST = 'Cart adds an item';

/** A browser of a `cypress run` with the plugin, and one test running. */
function browser(settings: unknown = settingsOf({ snap: true })): FakeBrowser {
  const fake = fakeBrowser({ settings });
  installSupport(fake.context);
  fake.beforeEach();
  return fake;
}

function snap(fake: FakeBrowser, name: unknown, options?: unknown): void {
  fake.command('probaraSnap')(name, options);
  fake.flush();
}

describe('cy.probaraSnap', () => {
  it('captures the viewport and hands the plugin a description and the PNG, as two files of the test', () => {
    const fake = browser();

    snap(fake, 'cart');

    expect(fake.screenshots).toHaveLength(1);
    const [capture] = fake.screenshots;
    expect(capture?.name).toMatch(/^probara-snap\/.+/);
    expect(capture?.options).toMatchObject({
      capture: 'viewport',
      overwrite: true,
      log: false,
      disableTimersAndAnimations: true,
      blackout: ['[data-probara-snap-mask]'],
    });
    expect(fake.payloads()).toEqual([
      {
        kind: 'attachment',
        line: {
          file: SPEC,
          test: TEST,
          type: 'attachment',
          name: '_probara_snap',
          contentType: 'application/vnd.probara.snap+json',
          body: 'text',
        },
        text: JSON.stringify({
          name: 'cart',
          // The window of the page, which `cy.viewport()` sizes, and not the default of the config.
          viewport: { width: 800, height: 600 },
          colorMode: 'light',
        }),
      },
      {
        kind: 'attachment',
        line: {
          file: SPEC,
          test: TEST,
          type: 'attachment',
          name: '_probara_snap',
          contentType: 'application/vnd.probara.snap+png',
          body: 'bytes',
        },
        path: `/work/app/cypress/screenshots/${capture?.name ?? ''}.png`,
      },
    ]);
    expect(fake.sent.every((task) => task.name === 'probara' && task.log === false)).toBe(true);
  });

  it('takes the whole page, masks, hides and removes what the options name, and sends the threshold', () => {
    const fake = browser();

    snap(fake, 'cart-whole', {
      fullPage: true,
      threshold: 0.2,
      mask: ['.total'],
      hide: ['.clock'],
      remove: ['.banner'],
    });

    const [capture] = fake.screenshots;
    expect(capture?.options).toMatchObject({
      capture: 'fullPage',
      blackout: ['[data-probara-snap-mask]', '.total'],
    });
    const [style = ''] = capture?.styles ?? [];
    expect(style).toContain('animation-duration: 0s !important');
    expect(style).toContain('caret-color: transparent !important');
    expect(style).toContain('[data-probara-snap-hide], .clock { visibility: hidden !important; }');
    expect(style).toContain('.banner { display: none !important; }');
    expect(JSON.parse(fake.payloads()[0]?.text ?? '{}')).toMatchObject({ threshold: 0.2 });
  });

  it('leaves the page as it was once the screenshot is taken', () => {
    const fake = browser();

    snap(fake, 'cart');

    expect(fake.screenshots[0]?.styles).toHaveLength(1);
    expect(fake.styles()).toEqual([]);
  });

  it('refuses a name used twice in one test, and takes it again in another test and in a retry', () => {
    const fake = browser();
    snap(fake, 'cart');

    expect(() => {
      snap(fake, 'cart');
    }).toThrow(
      'probaraSnap(): the name "cart" is already used in this test: screenshot names must be unique within a test',
    );

    fake.retry(1);
    snap(fake, 'cart');
    fake.retry(0);
    fake.beforeEach(['Cart', 'removes an item']);
    snap(fake, 'cart');
    expect(fake.screenshots).toHaveLength(3);
  });

  it('refuses a blank name and a threshold out of range', () => {
    const fake = browser();

    expect(() => {
      snap(fake, ' ');
    }).toThrow('probaraSnap(): the name must be a non-blank string');
    expect(() => {
      snap(fake, 'cart', { threshold: 2 });
    }).toThrow('probaraSnap(): threshold must be a number from 0 to 1');
    expect(fake.screenshots).toEqual([]);
  });

  it('takes nothing without the plugin, and says so once', () => {
    const fake = browser(null);

    snap(fake, 'cart');
    snap(fake, 'checkout');

    expect(fake.screenshots).toEqual([]);
    expect(fake.sent).toEqual([]);
    expect(fake.warnings.filter((warning) => warning.includes('probaraSnap'))).toEqual([
      'cy.probaraSnap() takes no screenshot: the Cypress config registers no plugin of @probara/cypress-reporter (probaraNodeEvents)',
    ]);
  });

  it('takes nothing in cypress open, where no build is sent', () => {
    const fake = browser(settingsOf({ snap: false }));

    snap(fake, 'cart');

    expect(fake.screenshots).toEqual([]);
    expect(fake.sent).toEqual([]);
    expect(fake.warnings).toEqual([]);
  });
});
