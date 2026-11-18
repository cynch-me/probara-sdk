import { describe, expect, it } from 'vitest';
import { reporterOptions, scriptOptions } from './script-options.js';

const ACME = '01JACME0000000000000000000';
const BETA = '01JBETA0000000000000000000';

describe('scriptOptions', () => {
  it('reads the API origin, the blur selectors and the locale of the script element', () => {
    expect(
      scriptOptions({
        apiOrigin: 'https://app.probara.net',
        blur: '.email, #card',
        locale: 'es',
        organizations: ACME,
      }),
    ).toEqual({
      apiOrigin: 'https://app.probara.net',
      blur: ['.email, #card'],
      locale: 'es',
      organizations: [ACME],
    });
  });

  it('reads the organizations separated by spaces, commas or both', () => {
    for (const organizations of [`${ACME} ${BETA}`, `${ACME},${BETA}`, ` ${ACME} ,\n ${BETA}, `]) {
      expect(scriptOptions({ organizations })).toEqual({ organizations: [ACME, BETA] });
    }
  });

  it('names no organization when the element has no data-organizations', () => {
    expect(scriptOptions({})).toEqual({ organizations: [] });
    expect(scriptOptions({ organizations: ' , ' })).toEqual({ organizations: [] });
  });

  it('ignores empty values and a locale it does not know', () => {
    expect(scriptOptions({ apiOrigin: '', blur: '  ', locale: 'fr', organizations: ACME })).toEqual(
      { organizations: [ACME] },
    );
  });

  it('opens nothing by itself when the element says data-manual', () => {
    expect(scriptOptions({ manual: '', organizations: ACME })).toBeNull();
  });
});

describe('reporterOptions', () => {
  const KEY = 'pvk_eyJ2IjoxfQ.c2ln';

  it('reads the widget key, the organizations and the options the recorder reads', () => {
    expect(
      reporterOptions({
        widgetKey: ` ${KEY} `,
        organizations: `${ACME}, ${BETA}`,
        apiOrigin: 'https://app.probara.net',
        blur: '.email',
        locale: 'es',
      }),
    ).toEqual({
      widgetKey: KEY,
      organizations: [ACME, BETA],
      apiOrigin: 'https://app.probara.net',
      blur: ['.email'],
      locale: 'es',
    });
  });

  it('reads data-launcher: on, off, or a position', () => {
    const launcherOf = (launcher: string | undefined) =>
      reporterOptions({ widgetKey: KEY, organizations: ACME, launcher })?.launcher;
    expect(launcherOf(undefined)).toBeUndefined();
    expect(launcherOf('')).toBe(true);
    expect(launcherOf('true')).toBe(true);
    expect(launcherOf('false')).toBe(false);
    expect(launcherOf('bottom-left')).toEqual({ position: 'bottom-left' });
    expect(launcherOf('bottom-right')).toEqual({ position: 'bottom-right' });
    expect(launcherOf('top')).toBe(true);
  });

  it('starts no reporter without data-widget-key, whatever data-manual says', () => {
    expect(reporterOptions({ organizations: ACME })).toBeNull();
    expect(reporterOptions({ widgetKey: '  ', organizations: ACME })).toBeNull();
    expect(reporterOptions({ widgetKey: KEY, organizations: ACME, manual: '' })).toEqual({
      widgetKey: KEY,
      organizations: [ACME],
    });
  });
});
