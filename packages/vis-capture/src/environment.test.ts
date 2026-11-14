/**
 * The environment of a capture, from what a browser exposes: user agent parsing, client hints,
 * and the API's limits on every field.
 */
import { describe, expect, it } from 'vitest';
import { collectEnvironment, parseUserAgent, type EnvironmentTarget } from './environment.js';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36';

describe('parseUserAgent', () => {
  it.each([
    [
      CHROME_MAC,
      { name: 'Chrome', version: '131.0.6778.86' },
      { name: 'macOS', version: '10.15.7' },
      'desktop',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68',
      { name: 'Edge', version: '130.0.2849.68' },
      { name: 'Windows', version: '10' },
      'desktop',
    ],
    [
      'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
      { name: 'Firefox', version: '132.0' },
      { name: 'Linux' },
      'desktop',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
      { name: 'Safari', version: '17.6' },
      { name: 'iOS', version: '17.6.1' },
      'mobile',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      { name: 'Chrome', version: '131.0.0.0' },
      { name: 'Android', version: '14' },
      'tablet',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 OPR/85.0.0.0',
      { name: 'Opera', version: '85.0.0.0' },
      { name: 'Android', version: '14' },
      'mobile',
    ],
    [
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      { name: 'Chrome', version: '131.0.0.0' },
      { name: 'ChromeOS' },
      'desktop',
    ],
  ])('reads %s', (userAgent, browser, os, device) => {
    expect(parseUserAgent(userAgent)).toEqual({ browser, os, device });
  });

  it('returns nothing it cannot recognize', () => {
    expect(parseUserAgent('curl/8.4.0')).toEqual({ device: 'desktop' });
  });
});

function fakeWindow(overrides: Partial<EnvironmentTarget> = {}): EnvironmentTarget {
  return {
    location: { href: 'https://shop.example/cart?session_id=abcdef123456' },
    document: { title: 'Cart' },
    navigator: { userAgent: CHROME_MAC, language: 'es-MX' },
    innerWidth: 1280,
    innerHeight: 720.4,
    screen: { width: 2560, height: 1440 },
    devicePixelRatio: 2,
    ...overrides,
  };
}

describe('collectEnvironment', () => {
  it('returns the page and the environment, with the names and formats a Vis accepts', async () => {
    const captured = await collectEnvironment(fakeWindow());
    expect(captured).toEqual({
      pageUrl: 'https://shop.example/cart?session_id=PROBARA_REDACTED',
      pageTitle: 'Cart',
      environment: {
        browser: { name: 'Chrome', version: '131.0.6778.86' },
        os: { name: 'macOS', version: '10.15.7' },
        device: 'desktop',
        viewport: { width: 1280, height: 720 },
        screen: { width: 2560, height: 1440 },
        pixelRatio: 2,
        locale: 'es-MX',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        userAgent: CHROME_MAC,
      },
    });
  });

  it('prefers client hints for the browser, the OS version and Windows 11', async () => {
    const captured = await collectEnvironment(
      fakeWindow({
        navigator: {
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          language: 'en-US',
          connection: { effectiveType: '4g' },
          userAgentData: {
            mobile: false,
            platform: 'Windows',
            getHighEntropyValues: () =>
              Promise.resolve({
                platformVersion: '15.0.0',
                fullVersionList: [
                  { brand: 'Not_A Brand', version: '24.0.0.0' },
                  { brand: 'Chromium', version: '131.0.6778.86' },
                  { brand: 'Google Chrome', version: '131.0.6778.86' },
                ],
              }),
          },
        },
      }),
    );
    expect(captured.environment.browser).toEqual({ name: 'Chrome', version: '131.0.6778.86' });
    expect(captured.environment.os).toEqual({ name: 'Windows', version: '11' });
    expect(captured.environment.networkType).toBe('4g');
  });

  it('falls back to the user agent when client hints fail', async () => {
    const captured = await collectEnvironment(
      fakeWindow({
        navigator: {
          userAgent: CHROME_MAC,
          language: 'en',
          userAgentData: {
            mobile: false,
            platform: 'macOS',
            getHighEntropyValues: () => Promise.reject(new Error('blocked')),
          },
        },
      }),
    );
    expect(captured.environment.browser).toEqual({ name: 'Chrome', version: '131.0.6778.86' });
    expect(captured.environment.os).toEqual({ name: 'macOS', version: '10.15.7' });
  });

  it('keeps every field within the limits a Vis accepts, and leaves out what does not fit', async () => {
    const captured = await collectEnvironment(
      fakeWindow({
        location: { href: `https://a.example/${'p'.repeat(3000)}` },
        document: { title: 't'.repeat(600) },
        navigator: {
          userAgent: 'x'.repeat(1200),
          language: '',
          connection: { effectiveType: 'slow-2g-and-much-more' },
        },
        innerWidth: 0,
        innerHeight: Number.NaN,
        screen: { width: 200_000, height: 900 },
        devicePixelRatio: 30,
      }),
    );
    expect(captured.pageUrl).toBeUndefined();
    expect(captured.pageTitle).toHaveLength(500);
    const { environment } = captured;
    expect(environment.userAgent).toHaveLength(1000);
    expect(environment).not.toHaveProperty('locale');
    expect(environment).not.toHaveProperty('networkType');
    expect(environment).not.toHaveProperty('viewport');
    expect(environment.screen).toEqual({ height: 900 });
    expect(environment).not.toHaveProperty('pixelRatio');
  });

  it('leaves out a page URL that is not http or https', async () => {
    const captured = await collectEnvironment(fakeWindow({ location: { href: 'about:blank' } }));
    expect(captured.pageUrl).toBeUndefined();
    expect(captured.environment.browser?.name).toBe('Chrome');
  });
});
