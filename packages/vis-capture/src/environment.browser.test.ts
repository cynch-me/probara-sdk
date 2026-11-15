/**
 * The environment of a capture read from a real Chromium page.
 */
import { describe, expect, it } from 'vitest';
import { collectEnvironment } from './environment.js';
import { REDACTED } from './redact.js';

describe('collectEnvironment in Chromium', () => {
  it('reads the page, the browser and the screen the test runs in', async () => {
    const { pageUrl, environment } = await collectEnvironment();
    // The runner's page URL carries a session id, redacted like any other.
    expect(pageUrl).toBe(location.href.replace(/sessionId=[^&]+/, `sessionId=${REDACTED}`));
    expect(environment.browser?.name).toMatch(/^Chrom/);
    expect(environment.browser?.version).toMatch(/^\d+\./);
    expect(environment.userAgent).toBe(navigator.userAgent);
    expect(environment.viewport).toEqual({ width: window.innerWidth, height: window.innerHeight });
    expect(environment.screen).toEqual({ width: screen.width, height: screen.height });
    expect(environment.pixelRatio).toBe(window.devicePixelRatio);
    expect(environment.locale).toBe(navigator.language);
    expect(environment.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(environment.device).toBe('desktop');
    expect(environment.os?.name).toBeTypeOf('string');
  });
});
