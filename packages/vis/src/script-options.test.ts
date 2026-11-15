import { describe, expect, it } from 'vitest';
import { scriptOptions } from './script-options.js';

describe('scriptOptions', () => {
  it('reads the API origin, the blur selectors and the locale of the script element', () => {
    expect(
      scriptOptions({ apiOrigin: 'https://app.probara.net', blur: '.email, #card', locale: 'es' }),
    ).toEqual({ apiOrigin: 'https://app.probara.net', blur: ['.email, #card'], locale: 'es' });
  });

  it('ignores empty values and a locale it does not know', () => {
    expect(scriptOptions({ apiOrigin: '', blur: '  ', locale: 'fr' })).toEqual({});
    expect(scriptOptions({})).toEqual({});
  });

  it('opens nothing by itself when the element says data-manual', () => {
    expect(scriptOptions({ manual: '' })).toBeNull();
  });
});
