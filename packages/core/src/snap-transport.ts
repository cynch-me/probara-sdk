/**
 * What the `probaraSnap` of an adapter and its reporter agree on, in the browser and in Node alike:
 * how a Probara Snap screenshot travels (two attachments of the attempt, a description then its
 * PNG), the options of a capture, and the styles that hold the page still. Platform-neutral: no
 * Node import, so it is part of `@probara/core/browser` too.
 */

/** The name of both attachments of a screenshot. */
export const SNAP_NAME = '_probara_snap';
/** The content type of the description: the name, the viewport, the color mode and the threshold, as JSON. */
export const SNAP_CONTENT_TYPE = 'application/vnd.probara.snap+json';
/** The content type of the PNG that follows its description. */
export const SNAP_IMAGE_CONTENT_TYPE = 'application/vnd.probara.snap+png';

export const SNAP_HIDE_ATTRIBUTE = '[data-probara-snap-hide]';
export const SNAP_MASK_ATTRIBUTE = '[data-probara-snap-mask]';
/** The color of the box painted over a masked element: Playwright's own mask color. */
export const SNAP_MASK_COLOR = '#FF00FF';

const MAX_NAME_LENGTH = 255;

/** Options of `probaraSnap`. */
export interface ProbaraSnapOptions {
  /** Take the whole document instead of the viewport. Defaults to `false`. */
  fullPage?: boolean | undefined;
  /**
   * How different two pixels must be to count as a change, from 0 (any difference) to 1. Probara's
   * default when unset.
   */
  threshold?: number | undefined;
  /** CSS selectors of elements painted over, besides `data-probara-snap-mask`. */
  mask?: readonly string[] | undefined;
  /** CSS selectors of elements made invisible, keeping their space, besides `data-probara-snap-hide`. */
  hide?: readonly string[] | undefined;
  /** CSS selectors of elements taken out of the layout. */
  remove?: readonly string[] | undefined;
}

/** What the description attachment of a screenshot holds. */
export interface SnapDescription {
  name: string;
  viewport?: { width: number; height: number };
  colorMode?: 'light' | 'dark';
  threshold?: number;
}

export function checkSnapName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_NAME_LENGTH) {
    throw new TypeError(
      `probaraSnap(): the name must be a non-blank string of at most ${MAX_NAME_LENGTH} characters`,
    );
  }
}

export function checkSnapThreshold(threshold: unknown): void {
  if (threshold === undefined) return;
  if (typeof threshold !== 'number' || !(threshold >= 0 && threshold <= 1)) {
    throw new TypeError('probaraSnap(): threshold must be a number from 0 to 1');
  }
}

/** The error of a name used twice in one test. */
export function duplicateSnapName(name: string): Error {
  return new Error(
    `probaraSnap(): the name "${name}" is already used in this test: screenshot names must be unique within a test`,
  );
}

/** The styles that hold the page still while it is captured, and hide what must not be compared. */
export function snapStabilizingCss(hide: readonly string[], remove: readonly string[]): string {
  const rules = [
    '*, *::before, *::after {',
    '  animation-delay: 0s !important;',
    '  animation-duration: 0s !important;',
    '  transition-delay: 0s !important;',
    '  transition-duration: 0s !important;',
    '  caret-color: transparent !important;',
    '  scroll-behavior: auto !important;',
    '}',
    `${[SNAP_HIDE_ATTRIBUTE, ...hide].join(', ')} { visibility: hidden !important; }`,
  ];
  if (remove.length > 0) rules.push(`${remove.join(', ')} { display: none !important; }`);
  return rules.join('\n');
}
