import type { Page, TestInfo } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import {
  createProbaraSnap,
  readSnapScreenshots,
  SNAP_CONTENT_TYPE,
  SNAP_IMAGE_CONTENT_TYPE,
  type ProbaraSnapOptions,
} from './snap.js';

type Attachment = TestInfo['attachments'][number];

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);

/** The members of a Page the helper uses, recording what it did in order. */
function fakePage(dark = false) {
  const calls: { method: string; argument?: unknown }[] = [];
  const page = {
    evaluate: (expression: string) => {
      calls.push({ method: 'evaluate', argument: expression });
      return Promise.resolve(expression.includes('prefers-color-scheme') ? dark : undefined);
    },
    addStyleTag: ({ content }: { content: string }) => {
      calls.push({ method: 'addStyleTag', argument: content });
      return Promise.resolve({
        evaluate: () => {
          calls.push({ method: 'removeStyle' });
          return Promise.resolve();
        },
      });
    },
    locator: (selector: string) => ({ selector }),
    screenshot: (options: unknown) => {
      calls.push({ method: 'screenshot', argument: options });
      return Promise.resolve(PNG);
    },
    viewportSize: () => ({ width: 1280, height: 720 }),
    context: () => ({ browser: () => ({ browserType: () => ({ name: () => 'webkit' }) }) }),
  };
  const of = (method: string) => calls.filter((call) => call.method === method);
  return { page: page as unknown as Page, calls, of };
}

function setup() {
  let info = { attachments: [] as Attachment[] };
  const snap = createProbaraSnap(() => info as unknown as TestInfo);
  return {
    snap: (page: Page, name: string, options?: ProbaraSnapOptions) => snap(page, name, options),
    attachments: () => info.attachments,
    nextTest: () => {
      info = { attachments: [] };
    },
  };
}

describe('probaraSnap', () => {
  it('waits for the fonts, stops animations and hides the caret before it takes a PNG, then restores the page', async () => {
    const { page, calls, of } = fakePage();

    await setup().snap(page, 'home');

    expect(calls.map((call) => call.method)).toEqual([
      'evaluate',
      'addStyleTag',
      'screenshot',
      'removeStyle',
      'evaluate',
    ]);
    expect(calls[0]?.argument).toContain('document.fonts.ready');
    const css = of('addStyleTag')[0]?.argument as string;
    expect(css).toMatch(/animation-duration: 0s !important/);
    expect(css).toMatch(/transition-duration: 0s !important/);
    expect(css).toMatch(/caret-color: transparent !important/);
    expect(of('screenshot')[0]?.argument).toMatchObject({
      type: 'png',
      fullPage: false,
      animations: 'disabled',
      caret: 'hide',
    });
  });

  it('takes the full page when asked', async () => {
    const { page, of } = fakePage();

    await setup().snap(page, 'home', { fullPage: true });

    expect(of('screenshot')[0]?.argument).toMatchObject({ fullPage: true });
  });

  it('masks selectors, locators and data-probara-snap-mask elements; hides and removes by injected CSS', async () => {
    const { page, of } = fakePage();
    const locator = { selector: 'role=img' };

    await setup().snap(page, 'home', {
      mask: ['.avatar', locator as never],
      hide: ['.clock', '#ad'],
      remove: ['.cookie-banner'],
    });

    expect(of('screenshot')[0]?.argument).toMatchObject({
      mask: [{ selector: '[data-probara-snap-mask]' }, { selector: '.avatar' }, locator],
    });
    const css = of('addStyleTag')[0]?.argument as string;
    expect(css).toContain(
      '[data-probara-snap-hide], .clock, #ad { visibility: hidden !important; }',
    );
    expect(css).toContain('.cookie-banner { display: none !important; }');
  });

  it('attaches the PNG with its name, browser, viewport, color scheme and threshold for the reporter', async () => {
    const { snap, attachments } = setup();

    await snap(fakePage(true).page, 'home', { threshold: 0.2 });
    await snap(fakePage().page, 'cart');

    expect(attachments().map(({ name, contentType }) => [name, contentType])).toEqual([
      ['_probara_snap', SNAP_CONTENT_TYPE],
      ['_probara_snap', SNAP_IMAGE_CONTENT_TYPE],
      ['_probara_snap', SNAP_CONTENT_TYPE],
      ['_probara_snap', SNAP_IMAGE_CONTENT_TYPE],
    ]);
    expect(readSnapScreenshots(attachments())).toEqual([
      {
        name: 'home',
        browser: 'webkit',
        viewport: { width: 1280, height: 720 },
        colorMode: 'dark',
        threshold: 0.2,
        body: PNG,
      },
      {
        name: 'cart',
        browser: 'webkit',
        viewport: { width: 1280, height: 720 },
        colorMode: 'light',
        body: PNG,
      },
    ]);
  });

  it('attaches the browser version and the page of an http or https URL, and leaves out any other page', async () => {
    const { snap, attachments } = setup();
    const at = (url: string) => {
      const { page } = fakePage();
      return {
        ...page,
        url: () => url,
        context: () => ({
          browser: () => ({ browserType: () => ({ name: () => 'webkit' }), version: () => '18.2' }),
        }),
      } as unknown as Page;
    };

    await snap(at('https://shop.test/cart?step=2'), 'cart');
    await snap(at('about:blank'), 'blank');

    expect(readSnapScreenshots(attachments())).toEqual([
      {
        name: 'cart',
        browser: 'webkit',
        browserVersion: '18.2',
        url: 'https://shop.test/cart?step=2',
        viewport: { width: 1280, height: 720 },
        colorMode: 'light',
        body: PNG,
      },
      {
        name: 'blank',
        browser: 'webkit',
        browserVersion: '18.2',
        viewport: { width: 1280, height: 720 },
        colorMode: 'light',
        body: PNG,
      },
    ]);
  });

  it('reads a screenshot a merged blob report holds as a file', () => {
    const meta = {
      name: '_probara_snap',
      contentType: SNAP_CONTENT_TYPE,
      body: Buffer.from(JSON.stringify({ name: 'home' })),
    };
    const image = {
      name: '_probara_snap',
      contentType: SNAP_IMAGE_CONTENT_TYPE,
      path: '/blob/a.png',
    };

    expect(readSnapScreenshots([meta, image])).toEqual([{ name: 'home', path: '/blob/a.png' }]);
    expect(readSnapScreenshots([meta])).toEqual([]);
    expect(readSnapScreenshots([{ ...meta, body: Buffer.from('not json') }, image])).toEqual([]);
  });

  it('throws on a name already used in the test, and takes it again in another test', async () => {
    const { snap, nextTest, attachments } = setup();
    await snap(fakePage().page, 'home');

    await expect(snap(fakePage().page, 'home')).rejects.toThrow(
      'probaraSnap(): the name "home" is already used in this test: screenshot names must be unique within a test',
    );
    expect(attachments()).toHaveLength(2);

    nextTest();
    await expect(snap(fakePage().page, 'home')).resolves.toBeUndefined();
  });

  it('throws on a name that is not a non-blank string of at most 255 characters, and on a threshold outside 0 to 1', async () => {
    const { snap, attachments } = setup();
    const { page, calls } = fakePage();

    await expect(snap(page, '  ')).rejects.toThrow('probaraSnap(): the name must be a non-blank');
    await expect(snap(page, 'x'.repeat(256))).rejects.toThrow('at most 255 characters');
    await expect(snap(page, 7 as unknown as string)).rejects.toThrow('probaraSnap(): the name');
    await expect(snap(page, 'home', { threshold: 1.5 })).rejects.toThrow(
      'probaraSnap(): threshold must be a number from 0 to 1',
    );
    expect(calls).toEqual([]);
    expect(attachments()).toEqual([]);
  });

  it('throws outside a test', async () => {
    const snap = createProbaraSnap(() => {
      throw new Error('test.info() can only be called while test is running');
    });

    await expect(snap(fakePage().page, 'home')).rejects.toThrow(
      'probaraSnap() only works while a test runs (in a test, a hook or a fixture)',
    );
  });
});
