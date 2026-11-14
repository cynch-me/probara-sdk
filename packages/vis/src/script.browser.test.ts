/**
 * The script-tag entry opens the recorder by itself when the page's address carries a token.
 */
import { afterEach, describe, expect, it } from 'vitest';

const startUrl = location.href;
const TOKEN = 'script.TOKEN-1';

afterEach(() => {
  history.replaceState(history.state, '', startUrl);
});

describe('the script-tag entry', () => {
  it('opens the recorder for the token of the address, and takes the token out', async () => {
    history.replaceState(history.state, '', `${startUrl}&probara-recording=${TOKEN}`);
    const api = await import('./script.js');
    expect(location.href).toBe(startUrl);
    expect(document.querySelector('[data-probara-vis-recorder]')).not.toBeNull();
    // The open recorder is the one startRecorder hands back.
    const recorder = api.startRecorder(TOKEN);
    recorder?.close();
    expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
  });
});
