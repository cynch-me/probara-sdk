import { describe, expect, it } from 'vitest';
import {
  createProbaraSnap,
  NOT_IN_BROWSER,
  type SnapDocument,
  type SnapElement,
} from './browser-snap.js';
import type { CurrentTest } from './current-test-slot.js';
import { SNAP_CONTENT_TYPE, SNAP_IMAGE_CONTENT_TYPE, SNAP_NAME } from '@probara/core';

const PNG = btoa('\u0089PNG');

interface FakeElement extends SnapElement {
  tag: string;
  children: FakeElement[];
  attached: boolean;
}

/** A document that records what a capture adds to it, and what it holds when the screenshot is taken. */
function fakeDocument(masked: number, href?: string) {
  const added: FakeElement[] = [];
  const create = (tag: string): FakeElement => {
    const element: FakeElement = {
      tag,
      children: [],
      attached: false,
      textContent: null,
      style: { cssText: '' },
      setAttribute: () => undefined,
      append: (...nodes) => {
        element.children.push(...(nodes as FakeElement[]));
      },
      remove: () => {
        element.attached = false;
      },
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 30, height: 40 }),
    };
    return element;
  };
  const attach = (node: SnapElement) => {
    (node as FakeElement).attached = true;
    added.push(node as FakeElement);
  };
  const root = create('html');
  root.append = attach;
  const selectors: string[] = [];
  const document: SnapDocument = {
    fonts: { ready: Promise.resolve() },
    head: { append: attach },
    documentElement: root,
    defaultView: {
      innerWidth: 414,
      innerHeight: 896,
      scrollX: 0,
      scrollY: 100,
      matchMedia: () => ({ matches: true }),
      ...(href === undefined ? {} : { location: { href } }),
    },
    createElement: create,
    querySelectorAll: (selector) => {
      selectors.push(selector);
      return Array.from({ length: masked }, () => create('span'));
    },
  };
  return { document, added, selectors, root };
}

function harness(masked = 0, href?: string) {
  const dom = fakeDocument(masked, href);
  const test = { name: 'renders', meta: {}, result: { retryCount: 0 } };
  const attached: { name: string; body: string | Uint8Array; contentType: string }[] = [];
  const warnings: string[] = [];
  const shots: { options: unknown; attachedNow: string[] }[] = [];
  let current: CurrentTest | undefined = { test, exact: false };
  let page: { screenshot(options: unknown): Promise<unknown> } | undefined = {
    screenshot: (options) => {
      shots.push({
        options,
        attachedNow: dom.added.filter((node) => node.attached).map((node) => node.tag),
      });
      return Promise.resolve(PNG);
    },
  };
  const snap = createProbaraSnap({
    current: () => current,
    page: () => page,
    document: () => dom.document,
    attach: (file) => {
      attached.push(file);
      return Promise.resolve();
    },
    warn: (message) => warnings.push(message),
  });
  return {
    snap,
    test,
    attached,
    warnings,
    shots,
    ...dom,
    outside: () => {
      current = undefined;
    },
    noPage: () => {
      page = undefined;
    },
  };
}

describe('probaraSnap in a browser', () => {
  it('hands the reporter a description and its PNG, with the viewport, the color mode and the threshold', async () => {
    const { snap, attached } = harness();

    await snap('cart', { threshold: 0.2 });

    expect(attached.map(({ name, contentType }) => [name, contentType])).toEqual([
      [SNAP_NAME, SNAP_CONTENT_TYPE],
      [SNAP_NAME, SNAP_IMAGE_CONTENT_TYPE],
    ]);
    expect(JSON.parse(attached[0]?.body as string)).toEqual({
      name: 'cart',
      viewport: { width: 414, height: 896 },
      colorMode: 'dark',
      threshold: 0.2,
    });
    expect([...(attached[1]?.body as Uint8Array)].slice(1, 4)).toEqual([0x50, 0x4e, 0x47]);
  });

  it('describes the page of an http or https URL, and leaves out any other', async () => {
    const http = harness(0, 'http://localhost:63315/__vitest_test__/cart');
    const blank = harness(0, 'about:blank');

    await http.snap('cart');
    await blank.snap('cart');

    expect(JSON.parse(http.attached[0]?.body as string)).toEqual({
      name: 'cart',
      viewport: { width: 414, height: 896 },
      colorMode: 'dark',
      url: 'http://localhost:63315/__vitest_test__/cart',
    });
    expect(JSON.parse(blank.attached[0]?.body as string)).toEqual({
      name: 'cart',
      viewport: { width: 414, height: 896 },
      colorMode: 'dark',
    });
  });

  it('holds the page still and masks it while it captures, and leaves the page as it was', async () => {
    const { snap, shots, added, selectors } = harness(2);

    await snap('cart', { mask: ['.price'], hide: ['.clock'], remove: ['.banner'] });

    expect(shots).toEqual([{ options: { save: false }, attachedNow: ['style', 'div'] }]);
    const [style, layer] = added;
    expect(style?.textContent).toContain('animation-duration: 0s !important');
    expect(style?.textContent).toContain('caret-color: transparent !important');
    expect(style?.textContent).toContain(
      '[data-probara-snap-hide], .clock { visibility: hidden !important; }',
    );
    expect(style?.textContent).toContain('.banner { display: none !important; }');
    expect(selectors).toEqual(['[data-probara-snap-mask], .price']);
    expect(layer?.children.map((box) => box.style.cssText)).toEqual([
      'position:absolute;left:10px;top:120px;width:30px;height:40px;background:#FF00FF;',
      'position:absolute;left:10px;top:120px;width:30px;height:40px;background:#FF00FF;',
    ]);
    expect(added.map((node) => node.attached)).toEqual([false, false]);
  });

  it('captures the whole document with fullPage', async () => {
    const { snap, shots, root } = harness();

    await snap('cart', { fullPage: true });

    expect(shots[0]?.options).toEqual({ save: false, element: root });
  });

  it('refuses a name used twice in a test, and takes it again in a retry', async () => {
    const { snap, test, attached } = harness();
    await snap('cart');

    await expect(snap('cart')).rejects.toThrow(
      'probaraSnap(): the name "cart" is already used in this test: screenshot names must be unique within a test',
    );
    test.result = { retryCount: 1 };
    await snap('cart');

    expect(attached).toHaveLength(4);
  });

  it('refuses a blank name and a threshold out of range before it captures', async () => {
    const { snap, shots } = harness();

    await expect(snap(' ')).rejects.toThrow('the name must be a non-blank string');
    await expect(snap('cart', { threshold: 2 })).rejects.toThrow(
      'threshold must be a number from 0 to 1',
    );
    expect(shots).toEqual([]);
  });

  it('captures nothing outside browser mode or outside a test, and says so once', async () => {
    const node = harness();
    node.noPage();
    await node.snap('cart');
    await node.snap('home');
    const outside = harness();
    outside.outside();
    await outside.snap('cart');

    expect(node.warnings).toEqual([NOT_IN_BROWSER]);
    expect(outside.warnings).toEqual([NOT_IN_BROWSER]);
    expect([...node.attached, ...outside.attached, ...outside.shots]).toEqual([]);
  });
});
