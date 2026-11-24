/**
 * Whether a replay records the page's linked stylesheets or only their addresses. Inlining a sheet
 * costs rrweb about 40 ms per full snapshot for 1.3 MB of CSS, and as much again in the events, so
 * a replay keeps only the address when the Probara servers can download the sheet after the replay
 * arrives. They download only public addresses, and keep a stylesheet of up to 2 MiB: a sheet on
 * another address, or a larger one, would leave the replay without its styles, so then the replay
 * inlines its stylesheets as before. The rules mirror the servers' (docs.probara.net, "How a replay
 * shows your page").
 */

/** The largest stylesheet the Probara servers keep. */
export const PROBARA_STYLESHEET_MAX_BYTES = 2 * 1024 * 1024;

const DEFAULT_PORT: Readonly<Record<string, string>> = { 'http:': '80', 'https:': '443' };
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan'];
const PROBARA_DOMAIN = 'probara.net';

/** Private, shared, loopback, link-local, benchmarking, multicast and reserved IPv4 ranges. */
function isPrivateIpv4(hostname: string): boolean {
  const [a = 0, b = 0, c = 0] = hostname.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b < 128) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b < 32) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Whether the Probara servers download `url` after a replay arrives. */
export function probaraCanFetch(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const defaultPort = DEFAULT_PORT[parsed.protocol];
  if (defaultPort === undefined) return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  if (parsed.port !== '' && parsed.port !== defaultPort) return false;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  // An IPv6 address is recorded with the page: telling a public one costs more than it saves.
  if (hostname.startsWith('[')) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return !isPrivateIpv4(hostname);
  if (hostname === 'localhost' || !hostname.includes('.')) return false;
  if (PRIVATE_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;
  return hostname !== PROBARA_DOMAIN && !hostname.endsWith(`.${PROBARA_DOMAIN}`);
}

/** The size of a downloaded file, from Resource Timing, when the page may read it. */
function downloadedBytes(url: string): number {
  const [entry] = performance.getEntriesByName(url, 'resource');
  return entry === undefined ? 0 : (entry as PerformanceResourceTiming).decodedBodySize;
}

/**
 * Whether a replay of `doc` has to inline its stylesheets: when the page or one of its linked
 * stylesheets is on an address the Probara servers never download, or a stylesheet is larger than
 * they keep.
 */
export function mustInlineStylesheets(
  doc: Pick<Document, 'location' | 'styleSheets'>,
  sizeOf: (url: string) => number = downloadedBytes,
): boolean {
  if (!probaraCanFetch(doc.location.href)) return true;
  for (const sheet of Array.from(doc.styleSheets)) {
    const href = sheet.href;
    if (href === null) continue;
    if (!probaraCanFetch(href) || sizeOf(href) > PROBARA_STYLESHEET_MAX_BYTES) return true;
  }
  return false;
}
