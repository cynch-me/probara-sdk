/** The client-side inbound filters: messages to ignore and the URLs errors may come from. */
import type { ProbaraEvent } from './types.js';

export type Pattern = string | RegExp;

/** Ignored unless the SDK is told otherwise: noise browsers report as errors. */
export const DEFAULT_IGNORE_ERRORS: readonly Pattern[] = Object.freeze([
  'ResizeObserver loop',
  'AbortError',
  'Script error.',
]);

/** Errors thrown from browser extensions never reach the app's issues. */
export const DEFAULT_DENY_URLS: readonly Pattern[] = Object.freeze([
  /^(?:chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i,
]);

/** A string matches as a substring, a regular expression by its own rules. */
export function matches(text: string, patterns: readonly Pattern[]): boolean {
  return patterns.some((pattern) => {
    if (typeof pattern === 'string') return text.includes(pattern);
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

/** The texts `ignoreErrors` is matched against: the message, and each exception as `Type: value`. */
export function messagesOf(event: ProbaraEvent): string[] {
  const out: string[] = [];
  if (event.message !== undefined) out.push(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value !== undefined) out.push(exception.value);
    if (exception.type !== undefined) {
      out.push(
        exception.value === undefined ? exception.type : `${exception.type}: ${exception.value}`,
      );
    }
  }
  return out;
}

/** The file of the frame that threw: the last frame of the last exception. */
export function urlOf(event: ProbaraEvent): string | undefined {
  const frames = event.exception?.values.at(-1)?.stacktrace?.frames ?? [];
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const filename = frames[index]?.filename;
    if (filename !== undefined && filename !== '<anonymous>' && filename !== '[native code]')
      return filename;
  }
  return undefined;
}
