/**
 * The script-tag entry of an element without `data-organizations` opens nothing: it warns once and
 * leaves the token in the address. In a file of its own, since the entry runs once per page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const startUrl = location.href;
const TOKEN = 'script.TOKEN-1';

afterEach(() => {
  history.replaceState(history.state, '', startUrl);
  vi.restoreAllMocks();
});

describe('the script-tag entry without data-organizations', () => {
  it('opens nothing, keeps the token in the address and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetch = vi.spyOn(globalThis, 'fetch');
    history.replaceState(history.state, '', `${startUrl}&probara-recording=${TOKEN}`);
    await import('./script.js');
    expect(location.href).toBe(`${startUrl}&probara-recording=${TOKEN}`);
    expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('data-organizations');
    expect(String(warn.mock.calls[0]?.[0])).not.toContain(TOKEN);
  });
});
