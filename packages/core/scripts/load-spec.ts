/** Loads the published OpenAPI document from a URL or a file. */
import { readFile } from 'node:fs/promises';
import type { OpenApiDocument } from './filter-openapi.ts';

export interface LoadSpecOptions {
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Timeout of a URL fetch, body included. Defaults to 60000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** The spec at `source`, an `http(s)` URL or a file path. A stalled fetch fails after `timeoutMs`. */
export async function loadSpec(
  source: string,
  options: LoadSpecOptions = {},
): Promise<OpenApiDocument> {
  if (!/^https?:\/\//.test(source)) {
    return JSON.parse(await readFile(source, 'utf8')) as OpenApiDocument;
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchImpl(source, { signal });
    if (!response.ok) {
      throw new Error(`Fetching ${source} failed with HTTP ${response.status}`);
    }
    return (await response.json()) as OpenApiDocument;
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`Fetching ${source} timed out after ${timeoutMs} ms`, { cause: error });
    }
    throw error;
  }
}
