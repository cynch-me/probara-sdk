/**
 * The custom metadata API: a site registers providers that describe the session (a user id, a
 * plan, a feature flag), evaluated each time a Vis is captured on the page, by this SDK's recorder
 * or by the Probara Vis extension, which asks the page over the handshake of the capture engine.
 */
import { answerMetadataRequests, normalizeMetadata, type VisMetadata } from '@probara/vis-capture';

/** Returns the metadata to attach to a Vis captured now: a JSON object. */
export type MetadataProvider = () => Record<string, unknown>;

const providers: MetadataProvider[] = [];
let stopAnswering: (() => void) | undefined;

function isThenable(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * The metadata of every provider, merged in the order they were registered (a later provider wins
 * a key), or `null` when none gives any. A provider that throws, returns anything but a JSON
 * object (a Promise included) or would take the whole over the size limit is skipped. Never
 * throws.
 */
export function collectMetadata(): VisMetadata | null {
  let merged: VisMetadata = {};
  for (const provider of [...providers]) {
    try {
      const value: unknown = provider();
      if (isThenable(value)) continue;
      const part = normalizeMetadata(value);
      if (part === null) continue;
      const candidate = normalizeMetadata({ ...merged, ...part });
      if (candidate !== null) merged = candidate;
    } catch {
      // A failing provider is ignored.
    }
  }
  return Object.keys(merged).length === 0 ? null : merged;
}

/**
 * Registers a metadata provider and returns the function that unregisters it. While one is
 * registered, the page answers the extension's metadata requests. Never throws.
 */
export function metadata(provider: MetadataProvider): () => void {
  if (typeof provider !== 'function') return () => undefined;
  providers.push(provider);
  stopAnswering ??= answerMetadataRequests(collectMetadata);
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    const index = providers.indexOf(provider);
    if (index !== -1) providers.splice(index, 1);
    if (providers.length === 0 && stopAnswering !== undefined) {
      stopAnswering();
      stopAnswering = undefined;
    }
  };
}
