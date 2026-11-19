import { describe, expect, it } from 'vitest';

import { stringsFor, type Locale } from './i18n.js';

const LOCALES: Locale[] = ['en', 'es'];

type Phrase = string | ((...values: string[]) => string);

describe('what the panel says to a visitor', () => {
  it('names no browser, since many more browsers exist than any list', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(stringsFor(locale)) as [string, Phrase][]) {
        const text = typeof value === 'function' ? value('1:00', '5:00') : value;
        expect(text, `${locale}.${key}`).not.toMatch(
          /\b(Chrome|Chromium|Edge|Firefox|Safari|Opera|Brave)\b/,
        );
      }
    }
  });
});
