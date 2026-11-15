/**
 * The recording link token in the page's address: `?probara-recording=<token>`. It is a secret,
 * so it is taken out of the address bar as soon as it is read, before anything else can record
 * the URL (the capture, an analytics script, a bookmark, a shared link).
 */

/** The query parameter that carries a recording link token. */
export const RECORDING_TOKEN_PARAM = 'probara-recording';

/** The longest token the intake accepts, in characters (printable ASCII). */
export const MAX_RECORDING_TOKEN_LENGTH = 448;

const TOKEN = /^[\x21-\x7e]+$/;

/** The window `takeRecordingToken` reads and rewrites: `globalThis` unless another is given. */
export interface TokenSource {
  location: { href: string };
  history: Pick<History, 'replaceState' | 'state'>;
}

/** `token` has the shape the intake accepts. */
export function isRecordingToken(token: unknown): token is string {
  return (
    typeof token === 'string' &&
    token.length > 0 &&
    token.length <= MAX_RECORDING_TOKEN_LENGTH &&
    TOKEN.test(token)
  );
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

/**
 * The recording link token of the page's address, or `null`. When the parameter is there, it is
 * removed from the address bar with `history.replaceState` (the rest of the address, the other
 * parameters as written and the history state are kept), whether the token is valid or not.
 * Never throws.
 */
export function takeRecordingToken(source: TokenSource = globalThis): string | null {
  try {
    const url = new URL(source.location.href);
    let token: string | undefined;
    const kept = url.search
      .slice(1)
      .split('&')
      .filter((piece) => {
        if (piece === '') return false;
        const eq = piece.indexOf('=');
        if (decode(eq === -1 ? piece : piece.slice(0, eq)) !== RECORDING_TOKEN_PARAM) return true;
        token ??= eq === -1 ? '' : decode(piece.slice(eq + 1));
        return false;
      });
    if (token === undefined) return null;
    const search = kept.length === 0 ? '' : `?${kept.join('&')}`;
    try {
      source.history.replaceState(source.history.state, '', `${url.pathname}${search}${url.hash}`);
    } catch {
      // A sandboxed or detached page: the token is still read once.
    }
    return isRecordingToken(token) ? token : null;
  } catch {
    return null;
  }
}
