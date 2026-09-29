import { describe, expect, it } from 'vitest';
import { MAX_BRANCH_LENGTH, MAX_BUILD_URL_LENGTH } from './limits.js';
import { sanitizeRunSource, type RunSource } from './source.js';

function sanitize(source: RunSource): { source: RunSource; warnings: string[] } {
  const warnings: string[] = [];
  return { source: sanitizeRunSource(source, (message) => warnings.push(message)), warnings };
}

describe('sanitizeRunSource', () => {
  it('keeps valid fields and warns about nothing', () => {
    const source = {
      branch: 'feat/cart',
      commit: '0f1e2d3c',
      buildUrl: 'https://ci.acme.test/builds/7',
    };
    expect(sanitize(source)).toEqual({ source, warnings: [] });
    expect(sanitize({})).toEqual({ source: {}, warnings: [] });
  });

  describe('branch', () => {
    it('removes control characters and surrounding whitespace', () => {
      expect(sanitize({ branch: '  fe\u0000at/\u009bcart\u007f\n' }).source).toEqual({
        branch: 'feat/cart',
      });
    });

    it('is dropped with a warning when blank', () => {
      expect(sanitize({ branch: ' \u0001 ' })).toEqual({
        source: {},
        warnings: ['Ignored a blank source branch'],
      });
    });

    it('is dropped, never truncated, when longer than the limit', () => {
      expect(sanitize({ branch: 'b'.repeat(MAX_BRANCH_LENGTH) }).source.branch).toHaveLength(
        MAX_BRANCH_LENGTH,
      );
      expect(sanitize({ branch: 'b'.repeat(MAX_BRANCH_LENGTH + 1) })).toEqual({
        source: {},
        warnings: [`Ignored a source branch longer than ${MAX_BRANCH_LENGTH} characters`],
      });
    });
  });

  describe('commit', () => {
    it('is trimmed', () => {
      expect(sanitize({ commit: ' abc123 \n' }).source).toEqual({ commit: 'abc123' });
    });

    it('is dropped when it holds characters outside visible ASCII or exceeds 64', () => {
      for (const commit of ['abc 123', 'abc\u0000', 'ábc', '', 'c'.repeat(65)]) {
        expect(sanitize({ commit })).toEqual({
          source: {},
          warnings: ['Ignored a source commit that is not 1 to 64 visible ASCII characters'],
        });
      }
      expect(sanitize({ commit: 'c'.repeat(64) }).source.commit).toHaveLength(64);
    });
  });

  it('replaces lone surrogates in the branch and the build URL with U+FFFD', () => {
    expect(
      sanitize({ branch: 'feat/\ud800', buildUrl: 'https://ci.acme.test/\udfff' }).source,
    ).toEqual({ branch: 'feat/\ufffd', buildUrl: 'https://ci.acme.test/\ufffd' });
  });

  describe('buildUrl', () => {
    it('keeps http and https URLs', () => {
      expect(sanitize({ buildUrl: ' http://ci.local:8080/job/1 ' }).source).toEqual({
        buildUrl: 'http://ci.local:8080/job/1',
      });
    });

    it('is dropped unless it is an http(s) URL within the limit', () => {
      const tooLong = `https://ci.acme.test/${'p'.repeat(MAX_BUILD_URL_LENGTH)}`;
      for (const buildUrl of ['ci.acme.test/7', 'javascript:alert(1)', 'ftp://ci/7', tooLong]) {
        expect(sanitize({ buildUrl })).toEqual({
          source: {},
          warnings: [
            `Ignored a source buildUrl that is not an http(s) URL of at most ${MAX_BUILD_URL_LENGTH} characters`,
          ],
        });
      }
    });
  });

  it('keeps the valid fields when others are dropped, one warning per field', () => {
    expect(sanitize({ branch: 'main', commit: 'not a sha', buildUrl: 'nope' })).toEqual({
      source: { branch: 'main' },
      warnings: [
        'Ignored a source commit that is not 1 to 64 visible ASCII characters',
        `Ignored a source buildUrl that is not an http(s) URL of at most ${MAX_BUILD_URL_LENGTH} characters`,
      ],
    });
  });
});
