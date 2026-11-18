/**
 * The script-tag entry opens the recorder by itself when the page's address carries a token, for
 * the organizations its element names in `data-organizations`.
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
    // The element the build runs from, as `document.currentScript` gives it while it loads.
    const element = document.createElement('script');
    element.dataset['organizations'] = '01JACME0000000000000000000 01JBETA0000000000000000000';
    element.dataset['apiOrigin'] = location.origin;
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => element });
    try {
      const api = await import('./script.js');
      expect(location.href).toBe(startUrl);
      expect(document.querySelector('[data-probara-vis-recorder]')).not.toBeNull();
      // The open recorder is the one startRecorder hands back.
      const recorder = api.startRecorder(TOKEN, { organizations: ['01JACME0000000000000000000'] });
      recorder?.close();
      expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
    } finally {
      Reflect.deleteProperty(document, 'currentScript');
    }
  });
});
