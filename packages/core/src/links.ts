/**
 * Links of a result (an issue, a TMS page, a build log), checked like the server checks them: an
 * absolute `http:` or `https:` URL, trimmed, at most {@link MAX_LINK_URL_LENGTH} characters, and an
 * optional name. An issue id becomes a link through a URL template (`issueUrlTemplate`). Nothing
 * here needs Node.
 */
import { MAX_LINK_NAME_LENGTH, MAX_LINK_URL_LENGTH, MAX_LINKS_PER_RESULT } from './limits.js';
import { toSingleLine, truncate } from './text.js';

/** A link of a result: where it points, and the text shown for it. */
export interface ResultLink {
  /** An absolute `http:` or `https:` URL, at most 2048 characters once trimmed. */
  url: string;
  /** Shown instead of the URL; 1..255 characters once trimmed. */
  name?: string;
}

/** Where `%s` goes in a URL template: the URL-encoded issue id. */
const ID_PLACEHOLDER = '%s';
/** An id a URL template is checked with: what it expands to must be a link the server accepts. */
const SAMPLE_ID = 'PRB-1';

/**
 * `value` trimmed when it is an absolute `http:` or `https:` URL of at most
 * {@link MAX_LINK_URL_LENGTH} characters, the URLs the server stores (any other scheme would run in
 * the viewer's browser); `undefined` otherwise.
 */
export function httpUrlOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const url = value.trim();
  if (url === '' || url.length > MAX_LINK_URL_LENGTH) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The link of issue `id` under `template`: every `%s` replaced by the URL-encoded id, named by the
 * id. The URL is checked when the result is converted, like any link.
 */
export function issueLink(id: string, template: string): ResultLink {
  const name = id.trim();
  return { url: template.replaceAll(ID_PLACEHOLDER, encodeURIComponent(name)), name };
}

/** Whether `template` holds `%s` and expands to a link the server accepts. */
export function isIssueUrlTemplate(template: string): boolean {
  return (
    template.includes(ID_PLACEHOLDER) && httpUrlOf(issueLink(SAMPLE_ID, template).url) !== undefined
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pushes `message` once: a message tells what kind of value was left out, not how many. */
function warnOnce(warnings: string[], message: string): void {
  if (!warnings.includes(message)) warnings.push(message);
}

/**
 * The links of a result within the contract, in order: URLs and names trimmed, a blank name left
 * out, a long one cut. A link without an absolute `http(s)` URL of at most
 * {@link MAX_LINK_URL_LENGTH} characters, or with a name that is not a string, is dropped, like
 * those beyond the first {@link MAX_LINKS_PER_RESULT}; `warnings` says so.
 */
export function toLinks(raw: unknown, warnings: string[]): ResultLink[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    warnOnce(warnings, 'Ignored links that are not a list');
    return undefined;
  }
  const links: ResultLink[] = [];
  for (const item of raw as unknown[]) {
    const url = isRecord(item) ? httpUrlOf(item.url) : undefined;
    if (!isRecord(item) || url === undefined) {
      warnOnce(
        warnings,
        `Dropped a link without an absolute http(s) URL of at most ${MAX_LINK_URL_LENGTH} characters`,
      );
      continue;
    }
    if (item.name !== undefined && typeof item.name !== 'string') {
      warnOnce(warnings, 'Dropped a link whose name is not a string');
      continue;
    }
    if (links.length === MAX_LINKS_PER_RESULT) {
      warnOnce(warnings, `Dropped the links beyond the first ${MAX_LINKS_PER_RESULT} of a result`);
      break;
    }
    let name = typeof item.name === 'string' ? toSingleLine(item.name) : '';
    if (name.length > MAX_LINK_NAME_LENGTH) {
      warnOnce(warnings, `Truncated a link name longer than ${MAX_LINK_NAME_LENGTH} characters`);
      name = truncate(name, MAX_LINK_NAME_LENGTH);
    }
    links.push(name === '' ? { url } : { url, name });
  }
  return links.length === 0 ? undefined : links;
}
