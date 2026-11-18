/**
 * The script-tag entry starts the reporter of in-app reporting from its element's
 * `data-widget-key`, with the launcher `data-launcher` asks for.
 */
import { describe, expect, it } from 'vitest';

describe('the script-tag entry with a widget key', () => {
  it('starts the reporter and its launcher, the one createReporter hands back', async () => {
    const element = document.createElement('script');
    element.dataset['widgetKey'] = 'pvk_eyJ2IjoxfQ.c2lnbmF0dXJl';
    element.dataset['organizations'] = '01JACME0000000000000000000';
    element.dataset['apiOrigin'] = location.origin;
    element.dataset['launcher'] = 'bottom-left';
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => element });
    try {
      const api = await import('./script.js');
      const host = document.querySelector<HTMLElement>('[data-probara-vis-launcher]');
      expect(host).not.toBeNull();
      expect(host?.style.getPropertyValue('left')).toBe('16px');
      // No recording link in the address: no recorder opened.
      expect(document.querySelector('[data-probara-vis-recorder]')).toBeNull();
      const reporter = api.createReporter({
        widgetKey: 'pvk_other.key',
        organizations: ['01JACME0000000000000000000'],
      });
      expect(reporter?.state).toBe('idle');
      reporter?.destroy();
      expect(document.querySelector('[data-probara-vis-launcher]')).toBeNull();
    } finally {
      Reflect.deleteProperty(document, 'currentScript');
    }
  });
});
