import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAutomationKey } from './automation-key.js';

// Golden vectors of automation key v1. The key links a test to its Probara case: changing any
// expected value below unlinks every case already reported with the old key.
describe('buildAutomationKey (v1 golden vectors)', () => {
  it('joins the file and the title path with " > "', () => {
    expect(
      buildAutomationKey({
        file: 'tests/login.spec.ts',
        titlePath: ['Login', 'rejects a bad password'],
      }),
    ).toBe('tests/login.spec.ts > Login > rejects a bad password');
    expect(buildAutomationKey({ titlePath: ['Checkout', 'pays by card'] })).toBe(
      'Checkout > pays by card',
    );
  });

  it('writes Windows paths with forward slashes, relative to the root', () => {
    expect(
      buildAutomationKey(
        { file: 'C:\\repo\\tests\\login.spec.ts', titlePath: ['Login', 'works'] },
        { rootDir: 'C:\\repo' },
      ),
    ).toBe('tests/login.spec.ts > Login > works');
    expect(buildAutomationKey({ file: '.\\tests\\\\unit\\a.test.ts', titlePath: ['adds'] })).toBe(
      'tests/unit/a.test.ts > adds',
    );
  });

  it('makes absolute POSIX paths relative to the root, the working directory by default', () => {
    expect(
      buildAutomationKey(
        { file: '/home/ci/repo/e2e/cart.spec.ts', titlePath: ['Cart', 'empties'] },
        { rootDir: '/home/ci/repo' },
      ),
    ).toBe('e2e/cart.spec.ts > Cart > empties');
    expect(
      buildAutomationKey({
        file: join(process.cwd(), 'e2e', 'cart.spec.ts'),
        titlePath: ['empties'],
      }),
    ).toBe('e2e/cart.spec.ts > empties');
  });

  it('cleans relative paths: leading ./, repeated slashes, surrounding spaces', () => {
    expect(buildAutomationKey({ file: ' ./e2e//cart.spec.ts ', titlePath: ['empties'] })).toBe(
      'e2e/cart.spec.ts > empties',
    );
    expect(buildAutomationKey({ file: '   ', titlePath: ['no file'] })).toBe('no file');
  });

  it('collapses control characters and whitespace in segments and drops empty ones', () => {
    expect(
      buildAutomationKey({ titlePath: ['  Login\t\tpage ', '', ' \n ', 'shows\nerror\u0000 '] }),
    ).toBe('Login page > shows error');
  });

  it('composes decomposed unicode so NFD and NFC inputs give the same key', () => {
    const nfd = buildAutomationKey({ file: 'cafe\u0301.spec.ts', titlePath: ['Cafe\u0301'] });
    expect(nfd).toBe('caf\u00e9.spec.ts > Caf\u00e9');
    expect(buildAutomationKey({ file: 'caf\u00e9.spec.ts', titlePath: ['Caf\u00e9'] })).toBe(nfd);
  });

  it('preserves case', () => {
    expect(buildAutomationKey({ titlePath: ['Login'] })).toBe('Login');
    expect(buildAutomationKey({ titlePath: ['login'] })).toBe('login');
  });

  it('appends parameters sorted by key to the last segment', () => {
    const key = buildAutomationKey({
      file: 'e2e/login.spec.ts',
      titlePath: ['Login', 'logs in'],
      parameters: { locale: 'es', browser: 'chromium' },
    });
    expect(key).toBe('e2e/login.spec.ts > Login > logs in [browser=chromium, locale=es]');
    expect(
      buildAutomationKey({
        file: 'e2e/login.spec.ts',
        titlePath: ['Login', 'logs in'],
        parameters: { browser: 'chromium', locale: 'es' },
      }),
    ).toBe(key);
  });

  it('renders parameter values with String() and sorts keys by code unit, not locale', () => {
    expect(
      buildAutomationKey({
        titlePath: ['retries'],
        parameters: { b: 1, B: true, a: 'x  y', headless: false },
      }),
    ).toBe('retries [B=true, a=x y, b=1, headless=false]');
    expect(buildAutomationKey({ titlePath: ['plain'], parameters: {} })).toBe('plain');
  });

  it('keeps a key of exactly 1024 code units as is', () => {
    const title = 'k'.repeat(1024);
    expect(buildAutomationKey({ titlePath: [title] })).toBe(title);
  });

  it('truncates a longer key and appends a hash of the full key', () => {
    const key = buildAutomationKey({ titlePath: ['x'.repeat(2000)] });
    expect(key).toBe(`${'x'.repeat(1006)} #5c0e0ea421571c30`);
    expect(key).toHaveLength(1024);
  });

  it('trims trailing spaces at the cut', () => {
    expect(buildAutomationKey({ titlePath: ['a'.repeat(1005), 'b'.repeat(100)] })).toBe(
      `${'a'.repeat(1005)} #635d761648a0a0f2`,
    );
  });

  it('does not split an emoji at the cut', () => {
    const key = buildAutomationKey({
      titlePath: [`${'a'.repeat(1005)}\u{1f600}${'b'.repeat(100)}`],
    });
    expect(key).toBe(`${'a'.repeat(1005)} #c1420fd21056136f`);
    expect(() => encodeURIComponent(key)).not.toThrow();
  });

  it('distinguishes long keys that share their first 1006 code units', () => {
    const shared = 'p'.repeat(1100);
    expect(buildAutomationKey({ titlePath: [shared, 'one'] })).not.toBe(
      buildAutomationKey({ titlePath: [shared, 'two'] }),
    );
  });

  it('throws a TypeError when no title segment remains', () => {
    expect(() => buildAutomationKey({ file: 'a.spec.ts', titlePath: [] })).toThrow(TypeError);
    expect(() => buildAutomationKey({ titlePath: [' ', '\t'], parameters: { a: 1 } })).toThrow(
      TypeError,
    );
  });
});
