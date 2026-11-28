/** What the page tells about where an event happened: the browser, the OS, the device and the page. */
import type { ProbaraEvent } from '@probara/error-core';
import { parseUserAgent, redactString } from '@probara/vis-capture';

/** The `browser`, `os` and `device` contexts of this page's browser. */
export function browserContexts(): Record<string, Record<string, unknown>> {
  const contexts: Record<string, Record<string, unknown>> = {};
  try {
    const { browser, os, device } = parseUserAgent(navigator.userAgent);
    if (browser !== undefined) contexts['browser'] = { ...browser };
    if (os !== undefined) contexts['os'] = { ...os };
    if (device !== undefined) contexts['device'] = { family: device };
  } catch {
    // No user agent to read.
  }
  return contexts;
}

/** `event` with the page's contexts and its request: the page URL, secrets redacted. */
export function withPage(
  event: ProbaraEvent,
  contexts: Record<string, Record<string, unknown>>,
): ProbaraEvent {
  const out: ProbaraEvent = { ...event, contexts: { ...contexts, ...event.contexts } };
  if (out.request === undefined) {
    try {
      out.request = {
        url: redactString(location.href),
        headers: { 'User-Agent': navigator.userAgent },
      };
    } catch {
      // No page to read.
    }
  }
  return out;
}
