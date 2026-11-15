import { describe, expect, it } from 'vitest';
import { RECORDING_TOKEN_PARAM, takeRecordingToken, type TokenSource } from './url.js';

/** A window whose address bar is `href`, recording what `replaceState` writes. */
function windowAt(href: string): TokenSource & { written: string[]; state: unknown } {
  const written: string[] = [];
  const state = { app: 'state' };
  return {
    written,
    state,
    location: { href },
    history: {
      state,
      replaceState(data: unknown, _unused: string, url?: string | URL | null) {
        expect(data).toBe(state);
        written.push(String(url));
      },
    },
  };
}

describe('takeRecordingToken', () => {
  it('reads the token and strips only its parameter from the address bar', () => {
    const win = windowAt(
      'https://shop.example.com/cart?step=2&probara-recording=abc.DEF_1-2&x=1#pay',
    );
    expect(RECORDING_TOKEN_PARAM).toBe('probara-recording');
    expect(takeRecordingToken(win)).toBe('abc.DEF_1-2');
    expect(win.written).toEqual(['/cart?step=2&x=1#pay']);
  });

  it('leaves no question mark when the token was the only parameter', () => {
    const win = windowAt('https://shop.example.com/?probara-recording=tok');
    expect(takeRecordingToken(win)).toBe('tok');
    expect(win.written).toEqual(['/']);
  });

  it('does nothing to a page without the parameter', () => {
    const win = windowAt('https://shop.example.com/cart?step=2');
    expect(takeRecordingToken(win)).toBeNull();
    expect(win.written).toEqual([]);
  });

  it('strips a token it refuses: empty, too long, or not printable ASCII', () => {
    for (const bad of ['', 'x'.repeat(449), 'caf%C3%A9', 'with%20space']) {
      const win = windowAt(`https://shop.example.com/?probara-recording=${bad}&keep=1`);
      expect(takeRecordingToken(win), bad).toBeNull();
      expect(win.written).toEqual(['/?keep=1']);
    }
    const longest = windowAt(`https://shop.example.com/?probara-recording=${'x'.repeat(448)}`);
    expect(takeRecordingToken(longest)).toBe('x'.repeat(448));
  });

  it('never throws, even when the history cannot be written', () => {
    const win = windowAt('https://shop.example.com/?probara-recording=tok');
    win.history.replaceState = () => {
      throw new Error('SecurityError');
    };
    expect(takeRecordingToken(win)).toBe('tok');
    expect(
      takeRecordingToken({ location: { href: 'not a url' }, history: win.history }),
    ).toBeNull();
  });
});
