/**
 * `probaraSnap(page, name)`: a screenshot for Probara Snap, taken in the worker and handed to the
 * reporter as two attachments of the attempt, a description ({@link SNAP_CONTENT_TYPE}) followed by
 * its PNG ({@link SNAP_IMAGE_CONTENT_TYPE}). Like the metadata of `probara.*`, they belong to one
 * attempt, survive blob reports and `merge-reports`, and are never uploaded as result attachments.
 */
import { test, type Locator, type Page, type TestInfo } from '@playwright/test';

/** The name of both attachments; terminal reporters skip names that start with `_`. */
export const SNAP_NAME = '_probara_snap';
export const SNAP_CONTENT_TYPE = 'application/vnd.probara.snap+json';
export const SNAP_IMAGE_CONTENT_TYPE = 'application/vnd.probara.snap+png';

const MAX_NAME_LENGTH = 255;
const HIDE_ATTRIBUTE = '[data-probara-snap-hide]';
const MASK_ATTRIBUTE = '[data-probara-snap-mask]';

/** Options of {@link probaraSnap}. */
export interface ProbaraSnapOptions {
  /** Take the whole scrollable page instead of the viewport. Defaults to `false`. */
  fullPage?: boolean | undefined;
  /**
   * How different two pixels must be to count as a change, from 0 (any difference) to 1. Probara's
   * default when unset.
   */
  threshold?: number | undefined;
  /** Elements painted over with a box: selectors or locators, besides `data-probara-snap-mask`. */
  mask?: readonly (string | Locator)[] | undefined;
  /** CSS selectors of elements made invisible, keeping their space, besides `data-probara-snap-hide`. */
  hide?: readonly string[] | undefined;
  /** CSS selectors of elements taken out of the layout. */
  remove?: readonly string[] | undefined;
}

/** A screenshot as the reporter reads it back: what `probaraSnap` recorded, and its PNG. */
export interface SnapScreenshot {
  name: string;
  browser?: string;
  viewport?: { width: number; height: number };
  colorMode?: 'light' | 'dark';
  threshold?: number;
  body?: Buffer;
  /** The PNG as a file: how a merged blob report holds it. */
  path?: string;
}

type Description = Omit<SnapScreenshot, 'body' | 'path'>;

function checkName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_NAME_LENGTH) {
    throw new TypeError(
      `probaraSnap(): the name must be a non-blank string of at most ${MAX_NAME_LENGTH} characters`,
    );
  }
}

function checkThreshold(threshold: unknown): void {
  if (threshold === undefined) return;
  if (typeof threshold !== 'number' || !(threshold >= 0 && threshold <= 1)) {
    throw new TypeError('probaraSnap(): threshold must be a number from 0 to 1');
  }
}

/** The styles that hold the page still while it is captured, and hide what must not be compared. */
function stabilizingCss(hide: readonly string[], remove: readonly string[]): string {
  const rules = [
    '*, *::before, *::after {',
    '  animation-delay: 0s !important;',
    '  animation-duration: 0s !important;',
    '  transition-delay: 0s !important;',
    '  transition-duration: 0s !important;',
    '  caret-color: transparent !important;',
    '  scroll-behavior: auto !important;',
    '}',
    `${[HIDE_ATTRIBUTE, ...hide].join(', ')} { visibility: hidden !important; }`,
  ];
  if (remove.length > 0) rules.push(`${remove.join(', ')} { display: none !important; }`);
  return rules.join('\n');
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function viewportOf(page: Page): Description['viewport'] {
  const size: unknown = page.viewportSize();
  if (typeof size !== 'object' || size === null) return undefined;
  const { width, height } = size as { width?: unknown; height?: unknown };
  return positiveInteger(width) && positiveInteger(height) ? { width, height } : undefined;
}

function browserOf(page: Page): string | undefined {
  try {
    const name: unknown = page.context().browser()?.browserType().name();
    return typeof name === 'string' && name !== '' ? name : undefined;
  } catch {
    return undefined;
  }
}

async function colorModeOf(page: Page): Promise<Description['colorMode']> {
  const dark: unknown = await page.evaluate(
    "window.matchMedia('(prefers-color-scheme: dark)').matches",
  );
  return typeof dark === 'boolean' ? (dark ? 'dark' : 'light') : undefined;
}

/** `probaraSnap`, bound to `testInfo()` (the running attempt). */
export function createProbaraSnap(
  testInfo: () => TestInfo,
): (page: Page, name: string, options?: ProbaraSnapOptions) => Promise<void> {
  /** The names each attempt used so far. */
  const taken = new WeakMap<TestInfo, Set<string>>();

  function current(): TestInfo {
    try {
      return testInfo();
    } catch {
      throw new Error(
        'probaraSnap() only works while a test runs (in a test, a hook or a fixture)',
      );
    }
  }

  return async (page, name, options = {}) => {
    const info = current();
    checkName(name);
    checkThreshold(options.threshold);
    const names = taken.get(info) ?? new Set<string>();
    taken.set(info, names);
    if (names.has(name)) {
      throw new Error(
        `probaraSnap(): the name "${name}" is already used in this test: screenshot names must be unique within a test`,
      );
    }
    names.add(name);

    await page.evaluate('document.fonts.ready.then(() => undefined)');
    const style = await page.addStyleTag({
      content: stabilizingCss(options.hide ?? [], options.remove ?? []),
    });
    let body: Buffer;
    try {
      body = await page.screenshot({
        type: 'png',
        fullPage: options.fullPage === true,
        animations: 'disabled',
        caret: 'hide',
        mask: [MASK_ATTRIBUTE, ...(options.mask ?? [])].map((target) =>
          typeof target === 'string' ? page.locator(target) : target,
        ),
      });
    } finally {
      await style
        .evaluate((node: { remove(): void }) => {
          node.remove();
        })
        .catch(() => undefined);
    }

    const browser = browserOf(page);
    const viewport = viewportOf(page);
    const colorMode = await colorModeOf(page);
    const description: Description = {
      name,
      ...(browser === undefined ? {} : { browser }),
      ...(viewport === undefined ? {} : { viewport }),
      ...(colorMode === undefined ? {} : { colorMode }),
      ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
    };
    // `push` adds no step to Playwright's reports, and keeps the pair together.
    info.attachments.push(
      {
        name: SNAP_NAME,
        contentType: SNAP_CONTENT_TYPE,
        body: Buffer.from(JSON.stringify(description)),
      },
      { name: SNAP_NAME, contentType: SNAP_IMAGE_CONTENT_TYPE, body: Buffer.from(body) },
    );
  };
}

/**
 * Takes a screenshot of `page` for Probara Snap, named `name` (unique within the test):
 * `await probaraSnap(page, 'checkout')`. Before the capture it waits for the fonts, stops CSS
 * animations and transitions, hides the caret, and applies the masking: `mask` (and elements with
 * `data-probara-snap-mask`) are painted over, `hide` (and `data-probara-snap-hide`) made
 * invisible, `remove` taken out of the layout. The reporter uploads the screenshots at the end
 * of the run.
 *
 * @throws on a name already used in the test, an invalid name or threshold, a call outside a
 *   test, and when Playwright cannot take the screenshot.
 */
export const probaraSnap = createProbaraSnap(() => test.info());

export function isSnapAttachment(attachment: { contentType: string }): boolean {
  return (
    attachment.contentType === SNAP_CONTENT_TYPE ||
    attachment.contentType === SNAP_IMAGE_CONTENT_TYPE
  );
}

function descriptionOf(body: Buffer | string | undefined): Description | undefined {
  try {
    const parsed = JSON.parse(
      typeof body === 'string' ? body : (body?.toString('utf8') ?? ''),
    ) as Description | null;
    return typeof parsed === 'object' && parsed !== null && typeof parsed.name === 'string'
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The screenshots `probaraSnap` attached to one attempt, in order: each description with the PNG
 * that follows it. A description that cannot be read, or without its PNG, is left out.
 */
export function readSnapScreenshots(
  attachments: readonly {
    contentType: string;
    body?: Buffer | string | undefined;
    path?: string | undefined;
  }[],
): SnapScreenshot[] {
  const screenshots: SnapScreenshot[] = [];
  for (const [index, attachment] of attachments.entries()) {
    if (attachment.contentType !== SNAP_CONTENT_TYPE) continue;
    const description = descriptionOf(attachment.body);
    const image = attachments[index + 1];
    if (description === undefined || image?.contentType !== SNAP_IMAGE_CONTENT_TYPE) continue;
    if (Buffer.isBuffer(image.body)) screenshots.push({ ...description, body: image.body });
    else if (typeof image.body === 'string') {
      screenshots.push({ ...description, body: Buffer.from(image.body, 'base64') });
    } else if (image.path !== undefined) screenshots.push({ ...description, path: image.path });
  }
  return screenshots;
}
