/**
 * The Jest test sandbox may not load `@probara/core` (two tests in `test/package.test.ts` pin it:
 * "loads neither the reporter nor the reporting library for the helpers alone" and "has a light
 * setup file for setupFilesAfterEnv, silent outside Jest and without the reporter"), so three
 * values of the channel protocol are written twice: in `src/channel.ts`, which the helpers and the
 * setup file reach inside a test file, and in `@probara/core`, which every other adapter uses.
 *
 * A drift between the two copies fails silently: the setup file would read the reporter's settings
 * as no selection, and every test the reporter had selected would run anyway. These tests run
 * outside the sandbox, so they compare the copies directly: if either changes and the other does
 * not, they fail here.
 */
import {
  attemptKey as coreAttemptKey,
  parseSelection as coreParseSelection,
  SELECTION_FAILURES as CORE_SELECTION_FAILURES,
} from '@probara/core';
import { describe, expect, it } from 'vitest';
import { attemptKey, parseSelection, SELECTION_FAILURES } from '../src/channel.js';

const SELECTION = {
  run: '01J9Z3K4M5N6P7Q8R9S0T1V2W3',
  keys: ['src/__tests__/login.test.js > login logs in with a valid password'],
  caseIds: ['SHOP-12', 'SHOP-13'],
  projectCodes: ['SHOP', 'WEB'],
  keyIncludesFile: true,
  rootDir: '/work/app',
};

/** Everything a settings file can hold as a selection, and what is not one. */
const VALUES: readonly unknown[] = [
  SELECTION,
  { ...SELECTION, keys: [], caseIds: [], projectCodes: [] },
  { ...SELECTION, keyIncludesFile: false },
  { ...SELECTION, captureOutput: true, somethingElse: 3 },
  // Every field missing, one at a time.
  { ...SELECTION, run: undefined },
  { ...SELECTION, keys: undefined },
  { ...SELECTION, caseIds: undefined },
  { ...SELECTION, projectCodes: undefined },
  { ...SELECTION, keyIncludesFile: undefined },
  { ...SELECTION, rootDir: undefined },
  // Every field of the wrong shape.
  { ...SELECTION, run: 42 },
  { ...SELECTION, keys: 'none' },
  { ...SELECTION, caseIds: ['SHOP-12', 3] },
  { ...SELECTION, projectCodes: [{ code: 'SHOP' }] },
  { ...SELECTION, keyIncludesFile: 'true' },
  { ...SELECTION, rootDir: ['/work/app'] },
  // Not an object at all.
  {},
  { run: '01J9Z3K4M5N6P7Q8R9S0T1V2W3' },
  null,
  undefined,
  'SHOP-12',
  12,
  [['SHOP-12']],
];

/** Attempts whose names a key must keep apart, whichever copy builds it. */
const ATTEMPTS: readonly (readonly [string, string, number])[] = [
  ['/work/app/src/__tests__/login.test.js', 'login logs in with a valid password', 1],
  ['/work/app/src/__tests__/login.test.js', 'login logs in with a valid password', 2],
  ['/work/app/src/__tests__/top-level.test.js', 'top-level test outside any describe', 1],
  // Names a key joins with " > ": two attempts that differ only in where the split falls.
  ['/work/app/src/a', 'b.test.js > adds an item', 1],
  ['/work/app/src/a/b.test.js', 'adds an item', 1],
  // Quotes and backslashes: the characters the key round-trips as JSON.
  ['/work/app/src/quotes.test.js', 'says "hello" and \\ escapes', 1],
  ['/work/app/src/quotes.test.js', "it's a test", 1],
  // Unicode, as the framework reports a title.
  ['/work/app/src/unicode.test.js', 'accepts café and ñandú', 1],
  ['/work/app/src/unicode.test.js', 'accepts café and ñandú (SHOP-12)', 1],
  ['/work/app/src/unicode.test.js', '日本のテスト', 1],
];

describe('the channel protocol of the test sandbox is core’s', () => {
  it('parseSelection: the sandbox copy and core’s read every settings value alike', () => {
    const mine = VALUES.map((value) => parseSelection(value));
    const theirs = VALUES.map((value) => coreParseSelection(value));

    // The table is worth comparing: it holds valid selections and malformed ones alike.
    expect(mine.filter((each) => each !== undefined)).not.toEqual([]);
    expect(theirs.filter((each) => each !== undefined)).not.toEqual([]);
    expect(mine).toEqual(theirs);
  });

  it('attemptKey: the sandbox copy and core’s key an attempt alike', () => {
    for (const [file, test, attempt] of ATTEMPTS) {
      expect(attemptKey(file, test, attempt)).toBe(coreAttemptKey(file, test, attempt));
    }
    // Two attempts are two keys, or the lines of one would answer for the other.
    expect(
      new Set(ATTEMPTS.map(([file, test, attempt]) => attemptKey(file, test, attempt))).size,
    ).toBe(ATTEMPTS.length);
  });

  it('SELECTION_FAILURES: the sandbox copy and core’s list the same reasons in the same order', () => {
    expect([...SELECTION_FAILURES]).toEqual([...CORE_SELECTION_FAILURES]);
  });
});
