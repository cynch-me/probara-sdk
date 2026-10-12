import { describe, expect, it } from 'vitest';
import { automationKeyOf, vitestIdentity, type IdentityContext } from './identity.js';

const ROOT = '/work/shop';
const context: IdentityContext = { projectCodes: ['PRB'], keyIncludesFile: true, rootDir: ROOT };

describe('vitestIdentity', () => {
  it('keys a test by its file relative to the root and its describes and title, as the JUnit import reads them', () => {
    const { identity } = vitestIdentity(
      `${ROOT}/tests/cart.test.ts`,
      'cart > adds an item',
      context,
    );
    expect(identity).toEqual({
      file: `${ROOT}/tests/cart.test.ts`,
      titlePath: ['cart', 'adds an item'],
    });
    expect(automationKeyOf(`${ROOT}/tests/cart.test.ts`, 'cart > adds an item', context)).toBe(
      'tests/cart.test.ts > cart > adds an item',
    );
  });

  it('takes the case ids out of the title path and lists them, the other project codes staying in the title', () => {
    const { identity, ids } = vitestIdentity(
      `${ROOT}/tests/checkout.test.ts`,
      'checkout > PRB-12 accepts café > WEB-7 keeps its code',
      context,
    );
    expect(ids).toEqual(['PRB-12']);
    expect(identity.titlePath).toEqual(['checkout', 'accepts café', 'WEB-7 keeps its code']);
  });

  it('keys a title holding " > " as the JUnit import does, which splits the name on that separator', () => {
    expect(automationKeyOf(`${ROOT}/a.test.ts`, 'suite > b > c', context)).toBe(
      'a.test.ts > suite > b > c',
    );
  });

  it('leaves the file out of the key without keyIncludesFile, and keeps the title path', () => {
    const plain = { ...context, keyIncludesFile: false };
    const { identity } = vitestIdentity(`${ROOT}/tests/cart.test.ts`, 'cart > adds an item', plain);
    expect(identity).toEqual({ titlePath: ['cart', 'adds an item'] });
    expect(automationKeyOf(`${ROOT}/tests/cart.test.ts`, 'cart > adds an item', plain)).toBe(
      'cart > adds an item',
    );
  });

  it('keys a file failure as the JUnit import reads the file name: the file, then the file again', () => {
    expect(automationKeyOf(`${ROOT}/tests/broken.test.ts`, 'tests/broken.test.ts', context)).toBe(
      'tests/broken.test.ts > tests/broken.test.ts',
    );
  });

  it('has no key for a test without a title', () => {
    expect(automationKeyOf(`${ROOT}/a.test.ts`, '', context)).toBeUndefined();
  });
});
