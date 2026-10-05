/**
 * How Cypress names the screenshot of a failed attempt, so the reporter finds the file of each
 * attempt by its name (measured in Cypress 16.1.1, whose screenshots are named with
 * `sanitize-filename` 1.6.3):
 *
 * - each title loses the characters a file name cannot hold (`/ ? < > \ : * | "` and control
 *   characters), and the titles are joined by ` -- `;
 * - ` (failed)` follows, then ` (attempt N)` for a retry;
 * - a name longer than {@link MAX_FILE_NAME_BYTES} bytes, extension included, is cut there (its
 *   suffixes with it), and a name that is already taken gets ` (1)`, ` (2)`… before the extension.
 *
 * A cut name no longer says which attempt it is of: the reporter tells those apart with the
 * attempt index `after:screenshot` gave the plugin.
 */

/** The characters `sanitize-filename` removes from a title. */
// eslint-disable-next-line no-control-regex -- control characters are what it removes
const ILLEGAL = /[/?<>\\:*|"\x00-\x1f\x80-\x9f]/g;
/** A title of dots only, which `sanitize-filename` empties. */
const RESERVED = /^\.+$/;
/** A title that is a reserved Windows device name, which `sanitize-filename` empties. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
/** The dots and spaces a Windows file name cannot end with, which `sanitize-filename` removes. */
const WINDOWS_TRAILING = /[. ]+$/;

/** The most bytes Cypress lets the name of a screenshot file take, extension included. */
export const MAX_FILE_NAME_BYTES = 254;

/** The bytes of `.png`, the extension of every screenshot. */
const PNG_BYTES = 4;

/** A copy Cypress made of a name that was taken: ` (1)`, ` (2)`… */
const COPY = / \(\d+\)$/;

/** One title as Cypress writes it in the name of a screenshot. */
export function screenshotTitle(title: string): string {
  return title
    .replace(ILLEGAL, '')
    .replace(RESERVED, '')
    .replace(WINDOWS_RESERVED, '')
    .replace(WINDOWS_TRAILING, '');
}

/**
 * The name, without its extension, Cypress gives the screenshot of the failed `attempt` (from 1)
 * of the test whose titles are `titles` (the describes, then the test; then the hook, for a hook
 * that failed), before it cuts it to fit.
 */
export function screenshotName(titles: readonly string[], attempt: number): string {
  const suffix = attempt === 1 ? ' (failed)' : ` (failed) (attempt ${String(attempt)})`;
  return `${titles.map(screenshotTitle).join(' -- ')}${suffix}`;
}

/**
 * Whether the file `name` (without its extension) is the screenshot named `wanted`: the same name,
 * a copy of it (` (1)`), or the name Cypress cut short to fit (a name that takes the most bytes a
 * file name can, and that `wanted` begins with).
 */
export function namesScreenshot(name: string, wanted: string): boolean {
  const own = name.replace(COPY, '');
  if (name === wanted || own === wanted) return true;
  // A cut name takes every byte the extension leaves (more, when the cut split a character).
  const cut = new TextEncoder().encode(name).length >= MAX_FILE_NAME_BYTES - PNG_BYTES;
  if (!cut) return false;
  // Cut in the middle of a character, the name ends with a replacement character.
  const prefix = own.replace(/\uFFFD+$/, '');
  return prefix !== '' && wanted.startsWith(prefix);
}
