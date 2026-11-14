import { describe, expect, it } from 'vitest';
import { MAX_ARGUMENT_LENGTH, serializeArgument } from './index.js';

describe('serializing a console argument', () => {
  it('keeps strings and writes primitives as the console shows them', () => {
    expect(serializeArgument('plain text')).toBe('plain text');
    expect(serializeArgument(42)).toBe('42');
    expect(serializeArgument(true)).toBe('true');
    expect(serializeArgument(null)).toBe('null');
    expect(serializeArgument(undefined)).toBe('undefined');
    expect(serializeArgument(10n)).toBe('10n');
    expect(serializeArgument(Symbol('id'))).toBe('Symbol(id)');
  });

  it('names functions instead of printing their source', () => {
    function checkout(): void {
      // body that must not be serialized
    }
    expect(serializeArgument(checkout)).toBe('[Function checkout]');
    expect(serializeArgument(() => 1)).toBe('[Function (anonymous)]');
  });

  it('writes an Error with its name, message and stack', () => {
    const error = new TypeError('cart is empty');
    const text = serializeArgument(error);
    expect(text.startsWith('TypeError: cart is empty')).toBe(true);
    expect(text).toContain('serialize.test.ts');
  });

  it('writes objects and arrays as JSON, with bigint and functions inside', () => {
    expect(serializeArgument({ id: 7, tags: ['a', 'b'], total: 5n, fn: () => 0 })).toBe(
      '{"id":7,"tags":["a","b"],"total":"5n","fn":"[Function fn]"}',
    );
  });

  it('marks cycles without failing, and keeps shared references that are not cycles', () => {
    const cart: Record<string, unknown> = { id: 1 };
    cart['self'] = cart;
    expect(serializeArgument(cart)).toBe('{"id":1,"self":"[Circular]"}');
    const item = { sku: 'A' };
    expect(serializeArgument({ first: item, second: item })).toBe(
      '{"first":{"sku":"A"},"second":{"sku":"A"}}',
    );
  });

  it('stops at the depth limit', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(serializeArgument(deep, { maxDepth: 2 })).toBe('{"a":{"b":"[Object]"}}');
    expect(serializeArgument([[[1]]], { maxDepth: 1 })).toBe('["[Array(1)]"]');
  });

  it('keeps at most the key limit and says how many keys it left out', () => {
    const wide = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`k${i}`, i]));
    expect(serializeArgument(wide, { maxKeys: 2 })).toBe('{"k0":0,"k1":1,"…":"3 more keys"}');
    expect(serializeArgument([1, 2, 3, 4], { maxKeys: 3 })).toBe('[1,2,3,"… 1 more item"]');
  });

  it('caps every argument at 5000 characters', () => {
    expect(MAX_ARGUMENT_LENGTH).toBe(5000);
    const text = serializeArgument('x'.repeat(12_000));
    expect(text).toHaveLength(5000);
    expect(text.endsWith('…')).toBe(true);
    expect(serializeArgument({ big: 'y'.repeat(9000) })).toHaveLength(5000);
    expect(serializeArgument('z'.repeat(5000))).toBe('z'.repeat(5000));
  });

  it('writes Map, Set, Date and RegExp readably', () => {
    expect(serializeArgument(new Map([['a', 1]]))).toBe('{"[Map]":[["a",1]]}');
    expect(serializeArgument(new Set([1, 2]))).toBe('{"[Set]":[1,2]}');
    expect(serializeArgument(new Date(0))).toBe('"1970-01-01T00:00:00.000Z"');
    expect(serializeArgument(/ab+c/gi)).toBe('/ab+c/gi');
  });

  it('never throws, even when reading the value throws', () => {
    const hostile = {
      ok: 1,
      get broken(): never {
        throw new Error('getter exploded');
      },
    };
    expect(serializeArgument(hostile)).toBe('{"ok":1,"broken":"[Unserializable]"}');
    const trap = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('trap');
        },
      },
    );
    expect(serializeArgument(trap)).toBe('[Unserializable]');
  });
});
