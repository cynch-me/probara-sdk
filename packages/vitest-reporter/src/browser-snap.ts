/**
 * `probaraSnap(name)` of a test that runs in a browser: a screenshot for Probara Snap, taken through the browser
 * provider's own screenshot (`page.screenshot` of Vitest's browser context) and handed to the reporter as two files of
 * the attempt, as `probara.attach()` hands any file over. Before the capture it waits for the fonts, stops animations
 * and transitions, hides the caret and applies the masking. No Node import: the browser loads it.
 */
import type { CurrentTest } from './current-test-slot.js';
import {
  checkSnapName,
  checkSnapThreshold,
  duplicateSnapName,
  SNAP_CONTENT_TYPE,
  SNAP_IMAGE_CONTENT_TYPE,
  SNAP_MASK_ATTRIBUTE,
  SNAP_MASK_COLOR,
  SNAP_NAME,
  snapStabilizingCss,
  type ProbaraSnapOptions,
  type SnapDescription,
} from '@probara/core/browser';

/** The slot of the browser's `page` on `globalThis`, set by the browser setup file of the Vitest major. */
export const BROWSER_PAGE_KEY = Symbol.for('@probara/vitest-reporter/browser-page/v1');

/** The part of Vitest's `page` a capture uses: with `save: false` it answers the PNG in base64. */
export interface SnapPage {
  screenshot(options: { save: false; element?: unknown }): Promise<unknown>;
}

/** The part of a rectangle a mask reads. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The part of an element a capture uses. */
export interface SnapElement {
  textContent: string | null;
  style: { cssText: string };
  setAttribute(name: string, value: string): void;
  append(...nodes: SnapElement[]): void;
  remove(): void;
  getBoundingClientRect(): Box;
}

/** The part of the test's document a capture uses. */
export interface SnapDocument {
  readonly fonts?: { readonly ready: Promise<unknown> } | undefined;
  readonly head: { append(node: SnapElement): void };
  readonly documentElement: SnapElement;
  readonly defaultView: {
    readonly innerWidth: number;
    readonly innerHeight: number;
    readonly scrollX: number;
    readonly scrollY: number;
    matchMedia(query: string): { matches: boolean };
  } | null;
  createElement(tag: string): SnapElement;
  querySelectorAll(selector: string): Iterable<SnapElement>;
}

/** What the platform gives `probaraSnap`. */
export interface SnapRuntime {
  /** The running test, as the `probara.*` helpers find it. */
  current(): CurrentTest | undefined;
  /** Vitest's `page`, or `undefined` outside browser mode. */
  page(): SnapPage | undefined;
  document(): SnapDocument | undefined;
  /** `probara.attach()`: the way a file of the attempt reaches the reporter. */
  attach(file: { name: string; body: string | Uint8Array; contentType: string }): Promise<void>;
  warn(message: string): void;
}

export const NOT_IN_BROWSER =
  'probaraSnap() takes screenshots in browser mode only: nothing is captured in this test';

/** The bytes of a base64 text, without `Buffer`: a browser has none. */
function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A box over every element of `selectors`, in one layer above the page; removing the layer removes them all. */
function maskLayerOf(document: SnapDocument, selectors: readonly string[]): SnapElement {
  const view = document.defaultView;
  const layer = document.createElement('div');
  layer.setAttribute('data-probara-snap-layer', '');
  layer.style.cssText =
    'position:absolute;left:0;top:0;width:0;height:0;margin:0;pointer-events:none;z-index:2147483647;';
  for (const element of document.querySelectorAll(selectors.join(', '))) {
    const { left, top, width, height } = element.getBoundingClientRect();
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;left:${left + (view?.scrollX ?? 0)}px;top:${top + (view?.scrollY ?? 0)}px;width:${width}px;height:${height}px;background:${SNAP_MASK_COLOR};`;
    layer.append(box);
  }
  return layer;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function descriptionOf(
  name: string,
  document: SnapDocument,
  threshold: number | undefined,
): SnapDescription {
  const view = document.defaultView;
  const width = view?.innerWidth;
  const height = view?.innerHeight;
  const dark = view?.matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    name,
    ...(positiveInteger(width) && positiveInteger(height) ? { viewport: { width, height } } : {}),
    ...(typeof dark === 'boolean' ? { colorMode: dark ? 'dark' : 'light' } : {}),
    ...(threshold === undefined ? {} : { threshold }),
  };
}

/** `probaraSnap`, bound to a platform. */
export function createProbaraSnap(
  runtime: SnapRuntime,
): (name: string, options?: ProbaraSnapOptions) => Promise<void> {
  /** The names each try of a test used so far: a retry takes its screenshots again. */
  const taken = new WeakMap<object, { attempt: string; names: Set<string> }>();
  let warned = false;

  function namesOf(found: CurrentTest): Set<string> {
    const { test } = found;
    const attempt = `${test.result?.repeatCount ?? 0}/${test.result?.retryCount ?? 0}`;
    const kept = taken.get(test);
    if (kept?.attempt === attempt) return kept.names;
    const names = new Set<string>();
    taken.set(test, { attempt, names });
    return names;
  }

  return async (name, options = {}) => {
    checkSnapName(name);
    checkSnapThreshold(options.threshold);
    const page = runtime.page();
    const document = runtime.document();
    const found = runtime.current();
    if (page === undefined || document === undefined || found === undefined) {
      if (!warned) runtime.warn(NOT_IN_BROWSER);
      warned = true;
      return;
    }
    const names = namesOf(found);
    if (names.has(name)) throw duplicateSnapName(name);
    names.add(name);

    await document.fonts?.ready;
    const style = document.createElement('style');
    style.textContent = snapStabilizingCss(options.hide ?? [], options.remove ?? []);
    document.head.append(style);
    const layer = maskLayerOf(document, [SNAP_MASK_ATTRIBUTE, ...(options.mask ?? [])]);
    document.documentElement.append(layer);
    let base64: unknown;
    try {
      base64 = await page.screenshot({
        save: false,
        ...(options.fullPage === true ? { element: document.documentElement } : {}),
      });
    } finally {
      layer.remove();
      style.remove();
    }
    if (typeof base64 !== 'string' || base64 === '') {
      throw new Error('probaraSnap(): the browser provider answered no screenshot');
    }
    const description = descriptionOf(name, document, options.threshold);
    await runtime.attach({
      name: SNAP_NAME,
      body: JSON.stringify(description),
      contentType: SNAP_CONTENT_TYPE,
    });
    await runtime.attach({
      name: SNAP_NAME,
      body: bytesOf(base64),
      contentType: SNAP_IMAGE_CONTENT_TYPE,
    });
  };
}
