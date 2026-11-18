/**
 * The script-tag entry with a widget key and no valid organizations: nothing starts, and the
 * console gets one warning, not one per feature.
 */
import { describe, expect, it, vi } from 'vitest';

describe('the script-tag entry with a widget key and no organizations', () => {
  it('starts nothing and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const element = document.createElement('script');
    element.dataset['widgetKey'] = 'pvk_eyJ2IjoxfQ.c2lnbmF0dXJl';
    element.dataset['launcher'] = '';
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => element });
    try {
      await import('./script.js');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('reporter did not start');
      expect(document.querySelector('[data-probara-vis-launcher]')).toBeNull();
    } finally {
      Reflect.deleteProperty(document, 'currentScript');
      warn.mockRestore();
    }
  });
});
