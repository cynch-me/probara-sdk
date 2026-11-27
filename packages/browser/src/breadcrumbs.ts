/**
 * The automatic breadcrumbs: what the shared capture records, turned into breadcrumbs. Console
 * calls (never events), fetch and XHR requests, clicks and navigations. Everything comes already
 * sanitized and redacted by the capture.
 */
import type { Breadcrumb, Level } from '@probara/error-core';
import type { CaptureRecord, ConsoleLevel, NetworkEntry } from '@probara/vis-capture';

const CONSOLE_LEVELS: Record<ConsoleLevel, Level> = {
  log: 'info',
  info: 'info',
  warn: 'warning',
  error: 'error',
  debug: 'debug',
  trace: 'debug',
};

/** The level of a request: errors for failures and 5xx, warnings for 4xx. */
export function httpLevel(status: number | null): Level {
  if (status === null || status >= 500) return 'error';
  return status >= 400 ? 'warning' : 'info';
}

/** A fetch or XHR request, as opposed to a WebSocket message or a loaded resource. */
export function isRequest(
  record: CaptureRecord,
): record is { stream: 'network'; entry: NetworkEntry } {
  return (
    record.stream === 'network' &&
    'kind' in record.entry &&
    (record.entry.kind === 'fetch' || record.entry.kind === 'xhr')
  );
}

/** The breadcrumb of `record`; `null` for what makes none. `previousUrl` is where a navigation left. */
export function breadcrumbOf(record: CaptureRecord, previousUrl: string): Breadcrumb | null {
  const timestamp = record.entry.ts / 1000;
  if (record.stream === 'console') {
    const { level, args } = record.entry;
    // The window's uncaught errors are events of their own, not breadcrumbs.
    if (level === 'error' && args.length === 1 && args[0]?.startsWith('Uncaught ') === true)
      return null;
    return {
      timestamp,
      type: 'debug',
      category: 'console',
      level: CONSOLE_LEVELS[level],
      message: args.join(' '),
    };
  }
  if (isRequest(record)) {
    const { kind, method, url, status } = record.entry;
    return {
      timestamp,
      type: 'http',
      category: kind,
      level: httpLevel(status),
      data: { method, url, status_code: status },
    };
  }
  if (record.stream === 'events') {
    const { type, target, url } = record.entry;
    if (type === 'click') {
      return {
        timestamp,
        type: 'default',
        category: 'ui.click',
        message: target?.selector ?? target?.tag ?? '',
      };
    }
    if (type === 'navigation') {
      return {
        timestamp,
        type: 'navigation',
        category: 'navigation',
        data: { from: previousUrl, to: url },
      };
    }
  }
  return null;
}
