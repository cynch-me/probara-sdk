/**
 * The names Cypress gives the screenshots of failed attempts, as measured in a real Cypress 16.1.1
 * run, and how the reporter recognizes them.
 */
import { describe, expect, it } from 'vitest';
import { namesScreenshot, screenshotName, screenshotTitle } from './screenshot-name.js';

describe('screenshotName', () => {
  it('names a failed attempt as Cypress does: titles cleaned, joined, then the suffixes', () => {
    // Measured: `describe('Suite: a/b')` › `it('fails: with / and : and "q"')`.
    const titles = ['Suite: a/b', 'fails: with / and : and "q"'];
    expect(screenshotName(titles, 1)).toBe('Suite ab -- fails with  and  and q (failed)');
    expect(screenshotName(titles, 2)).toBe(
      'Suite ab -- fails with  and  and q (failed) (attempt 2)',
    );
  });

  it('cleans what sanitize-filename cleans', () => {
    expect(screenshotTitle('a\\b*c?d<e>f|g')).toBe('abcdefg');
    expect(screenshotTitle('ends with dots...')).toBe('ends with dots');
    expect(screenshotTitle('..')).toBe('');
    expect(screenshotTitle('CON')).toBe('');
  });
});

describe('namesScreenshot', () => {
  const long = `Suite ab -- long ${'x'.repeat(300)}`;
  const wanted = `${long} (failed) (attempt 2)`;
  /** A name Cypress cut to `bytes` bytes. */
  const cut = (name: string, bytes: number) => Buffer.from(name).subarray(0, bytes).toString();

  it('recognizes the name itself, and a copy Cypress made of a taken name', () => {
    expect(namesScreenshot('A -- b (failed)', 'A -- b (failed)')).toBe(true);
    expect(namesScreenshot('A -- b (failed) (1)', 'A -- b (failed)')).toBe(true);
    expect(namesScreenshot('A -- b (failed)', 'A -- b (failed) (attempt 2)')).toBe(false);
    expect(namesScreenshot('A -- bc (failed)', 'A -- b (failed)')).toBe(false);
  });

  it('recognizes a name Cypress cut to 254 bytes, and its copy', () => {
    // Measured: 250 bytes and `.png`; the copy keeps 246 bytes, then ` (1).png`.
    expect(namesScreenshot(cut(wanted, 250), wanted)).toBe(true);
    expect(namesScreenshot(`${cut(wanted, 246)} (1)`, wanted)).toBe(true);
    expect(namesScreenshot(cut(`Suite ab -- other ${'x'.repeat(300)}`, 250), wanted)).toBe(false);
  });

  it('recognizes a name cut in the middle of a character', () => {
    const accented = `Suite -- ${'é'.repeat(200)} (failed)`;
    const name = cut(accented, 250);
    expect(name.endsWith('\uFFFD')).toBe(true);
    expect(namesScreenshot(name, accented)).toBe(true);
  });

  it('never takes a short name for a cut one', () => {
    expect(namesScreenshot('Suite ab -- long', wanted)).toBe(false);
  });
});
