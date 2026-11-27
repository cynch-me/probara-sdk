/**
 * Outgoing `fetch` requests as breadcrumbs, and failed requests to the configured targets as
 * events. 400, 401 and 404 are never events.
 */
import type { Client, Level, Pattern } from '@probara/error-core';
import { scrubUrl } from './privacy.js';

/** HTTP statuses never sent as events, whatever `httpErrors` says. */
export const NEVER_CAPTURED_STATUSES: readonly number[] = Object.freeze([400, 401, 404]);

export interface HttpErrorRules {
  /** URLs whose failed responses are sent as events: prefixes or regular expressions. */
  targets: readonly Pattern[];
  /** Statuses or ranges sent: 500–599 unless given. */
  statuses?: readonly (number | readonly [number, number])[];
}

function levelOf(status: number | null): Level {
  if (status === null || status >= 500) return 'error';
  return status >= 400 ? 'warning' : 'info';
}

function statusMatches(
  status: number,
  statuses: readonly (number | readonly [number, number])[],
): boolean {
  if (NEVER_CAPTURED_STATUSES.includes(status)) return false;
  return statuses.some((rule) =>
    typeof rule === 'number' ? rule === status : status >= rule[0] && status <= rule[1],
  );
}

function isTarget(url: string, targets: readonly Pattern[]): boolean {
  return targets.some((target) => {
    if (typeof target === 'string') return url.startsWith(target);
    target.lastIndex = 0;
    return target.test(url);
  });
}

function describeRequest(input: Parameters<typeof fetch>[0], init?: RequestInit) {
  if (input instanceof Request) return { url: input.url, method: init?.method ?? input.method };
  return { url: String(input), method: init?.method ?? 'GET' };
}

/** Wraps the global `fetch`; returns what puts the original back. */
export function instrumentFetch(
  client: () => Client | undefined,
  rules: HttpErrorRules | undefined,
): () => void {
  const original = globalThis.fetch;
  if (typeof original !== 'function') return () => undefined;

  function record(url: string, method: string, status: number | null): void {
    try {
      report(url, method, status);
    } catch {
      // Recording a request never breaks it.
    }
  }

  function report(url: string, method: string, status: number | null): void {
    const current = client();
    if (current === undefined) return;
    const safeUrl = scrubUrl(url);
    const upper = method.toUpperCase();
    current.addBreadcrumb({
      type: 'http',
      category: 'fetch',
      level: levelOf(status),
      data: { method: upper, url: safeUrl, status_code: status },
    });
    if (rules === undefined || status === null) return;
    if (!statusMatches(status, rules.statuses ?? [[500, 599]])) return;
    if (!isTarget(url, rules.targets)) return;
    current.captureEvent(
      {
        level: 'error',
        exception: {
          values: [
            {
              type: 'Error',
              value: `HTTP Client Error with status code: ${String(status)}`,
              mechanism: { type: 'http.client', handled: false, synthetic: true },
            },
          ],
        },
        request: { url: safeUrl, method: upper },
        contexts: { response: { status_code: status } },
      },
      { mechanism: { type: 'http.client', handled: false } },
    );
  }

  const wrapped: typeof fetch = async (input, init) => {
    let described: { url: string; method: string } | undefined;
    try {
      described = describeRequest(input, init);
    } catch {
      described = undefined;
    }
    try {
      const response = await original(input, init);
      if (described !== undefined) record(described.url, described.method, response.status);
      return response;
    } catch (error) {
      if (described !== undefined) record(described.url, described.method, null);
      throw error;
    }
  };
  globalThis.fetch = wrapped;
  return () => {
    if (globalThis.fetch === wrapped) globalThis.fetch = original;
  };
}
