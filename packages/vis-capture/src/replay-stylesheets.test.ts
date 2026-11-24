/**
 * Which stylesheet addresses the Probara servers download after a replay arrives: the rest has to
 * be recorded with the page.
 */
import { describe, expect, it } from 'vitest';
import {
  mustInlineStylesheets,
  PROBARA_STYLESHEET_MAX_BYTES,
  probaraCanFetch,
} from './replay-stylesheets.js';

describe('probaraCanFetch', () => {
  it('reaches a public site on its default port', () => {
    expect(probaraCanFetch('https://development.cynch.me/styles.css')).toBe(true);
    expect(probaraCanFetch('http://example.com:80/a.css')).toBe(true);
    expect(probaraCanFetch('https://8.8.8.8/a.css')).toBe(true);
  });

  it.each([
    'http://localhost:4200/styles.css',
    'http://app.localhost/a.css',
    'http://intranet/a.css',
    'https://build.local/a.css',
    'https://ci.internal/a.css',
    'https://nas.home.arpa/a.css',
    'https://router.lan/a.css',
    'http://127.0.0.1/a.css',
    'http://10.0.0.5/a.css',
    'http://172.20.1.1/a.css',
    'http://192.168.1.10/a.css',
    'http://169.254.0.1/a.css',
    'http://100.64.0.1/a.css',
    'http://[::1]/a.css',
    'https://example.com:8443/a.css',
    'https://user:secret@example.com/a.css',
    'https://app.probara.net/a.css',
    'blob:https://example.com/0b1c',
    'data:text/css,a{}',
    'not a url',
  ])('never reaches %s', (url) => {
    expect(probaraCanFetch(url)).toBe(false);
  });
});

describe('mustInlineStylesheets', () => {
  /** A page at `page` with linked stylesheets at `sheets` (`null` for a `<style>` element). */
  function page(href: string, sheets: (string | null)[]) {
    return {
      location: { href },
      styleSheets: sheets.map((sheet) => ({ href: sheet })),
    } as unknown as Pick<Document, 'location' | 'styleSheets'>;
  }
  const small = () => 1_300_000;

  it('keeps only the addresses on a public page whose stylesheets the servers download', () => {
    const shop = page('https://shop.example.com/orders', ['https://cdn.example.com/app.css', null]);
    expect(mustInlineStylesheets(shop, small)).toBe(false);
  });

  it('inlines on a page the servers never reach', () => {
    expect(mustInlineStylesheets(page('http://localhost:4200/', []), small)).toBe(true);
  });

  it('inlines when one stylesheet is on an address the servers never reach', () => {
    const shop = page('https://shop.example.com/', [
      'https://cdn.example.com/a.css',
      'http://localhost:4200/b.css',
    ]);
    expect(mustInlineStylesheets(shop, small)).toBe(true);
  });

  it('inlines when one stylesheet is larger than the servers keep', () => {
    const shop = page('https://shop.example.com/', ['https://cdn.example.com/a.css']);
    expect(mustInlineStylesheets(shop, () => PROBARA_STYLESHEET_MAX_BYTES)).toBe(false);
    expect(mustInlineStylesheets(shop, () => PROBARA_STYLESHEET_MAX_BYTES + 1)).toBe(true);
  });
});
