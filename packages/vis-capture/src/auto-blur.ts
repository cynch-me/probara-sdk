/**
 * Auto-blur: what a recording blurs without the site naming it in code. The engine's attribute,
 * the privacy markers of other session replay tools, the selectors of `<meta name="probara:blur">`
 * tags and the selectors an SDK is given, all through a blur controller, which also covers the
 * elements added later.
 */
import { BLUR_ATTRIBUTE, type BlurController } from './blur.js';

/** The `<meta>` name whose `content` is a CSS selector list to blur. */
export const BLUR_META_NAME = 'probara:blur';

/**
 * Elements other session replay tools keep out of their recordings, blurred here too, so a site
 * already marked for them needs nothing more.
 */
export const PRIVACY_SELECTORS: readonly string[] = Object.freeze([
  `[${BLUR_ATTRIBUTE}]`,
  // The replay recorder's own markers
  '.rr-block',
  '.rr-mask',
  // Sentry Session Replay
  '.sentry-block',
  '.sentry-mask',
  '[data-sentry-block]',
  '[data-sentry-mask]',
  // FullStory
  '.fs-exclude',
  '.fs-mask',
  // Hotjar
  '[data-hj-suppress]',
  // LogRocket
  '[data-private]',
  // OpenReplay
  '[data-openreplay-obscured]',
  '[data-openreplay-masked]',
  '[data-openreplay-hidden]',
  // Datadog RUM
  '[data-dd-privacy="mask"]',
  '[data-dd-privacy="hidden"]',
  '.dd-privacy-mask',
  '.dd-privacy-hidden',
  // PostHog
  '.ph-no-capture',
  // Microsoft Clarity
  '[data-clarity-mask="true"]',
]);

/** The selector lists of every `probara:blur` meta tag of `doc`, in document order. */
export function metaBlurSelectors(doc: Document): string[] {
  try {
    return [...doc.querySelectorAll(`meta[name="${BLUR_META_NAME}"]`)]
      .map((meta) => (meta.getAttribute('content') ?? '').trim())
      .filter((content) => content !== '');
  } catch {
    return [];
  }
}

/**
 * Blurs every selector through `controller`: the privacy selectors, the meta tags', then
 * `extra`. A selector that is not valid CSS is skipped; the others still apply.
 */
export function applyAutoBlur(
  controller: BlurController,
  doc: Document,
  extra: readonly string[] = [],
): void {
  for (const selector of [...PRIVACY_SELECTORS, ...metaBlurSelectors(doc), ...extra]) {
    try {
      if (typeof selector === 'string' && selector.trim() !== '') controller.blur(selector);
    } catch {
      // Not valid CSS: skipped.
    }
  }
}
