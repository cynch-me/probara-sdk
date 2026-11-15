import { MAX_METADATA_BYTES, MAX_METADATA_DEPTH } from '@probara/vis-capture';
import { afterEach, describe, expect, it } from 'vitest';
import { collectMetadata, metadata } from './metadata.js';

const registered: (() => void)[] = [];

afterEach(() => {
  for (const unregister of registered.splice(0)) unregister();
});

function add(provider: () => unknown): () => void {
  const unregister = metadata(provider as () => Record<string, unknown>);
  registered.push(unregister);
  return unregister;
}

describe('metadata', () => {
  it('reports nothing until a provider is registered', () => {
    expect(collectMetadata()).toBeNull();
  });

  it('merges every provider in the order they were registered, the later winning a key', () => {
    let plan = 'free';
    add(() => ({ user: 'u-1', plan }));
    add(() => ({ plan: 'pro', cart: { items: 2 } }));
    plan = 'changed at capture time';
    expect(collectMetadata()).toEqual({ user: 'u-1', plan: 'pro', cart: { items: 2 } });
  });

  it('evaluates providers when asked, not when registered', () => {
    let calls = 0;
    add(() => ({ calls: (calls += 1) }));
    expect(calls).toBe(0);
    expect(collectMetadata()).toEqual({ calls: 1 });
    expect(collectMetadata()).toEqual({ calls: 2 });
  });

  it('ignores a provider that throws or returns anything but a JSON object', () => {
    add(() => ({ kept: true }));
    add(() => {
      throw new Error('provider failed');
    });
    add(() => 'text');
    add(() => [1, 2]);
    add(() => Promise.resolve({ late: true }));
    add(() => null);
    expect(collectMetadata()).toEqual({ kept: true });
  });

  it('skips a provider that would take the metadata over the limit, keeping the others', () => {
    add(() => ({ first: 'a' }));
    add(() => ({ huge: 'x'.repeat(MAX_METADATA_BYTES) }));
    add(() => ({ last: 'b' }));
    expect(collectMetadata()).toEqual({ first: 'a', last: 'b' });
  });

  it('skips a provider whose metadata is nested deeper than the limit, keeping the others', () => {
    let deep: unknown = 1;
    for (let level = 0; level < 100_000; level += 1) deep = { a: deep };
    let edge: unknown = 1;
    // With its key under the root, 31 objects make the merged metadata 32 levels deep.
    for (let level = 0; level < MAX_METADATA_DEPTH - 1; level += 1) edge = { a: edge };
    add(() => ({ first: 'a' }));
    add(() => ({ tooDeep: { a: edge } }));
    add(() => ({ hostile: deep }));
    add(() => ({ edge }));
    expect(collectMetadata()).toEqual({ first: 'a', edge });
  });

  it('stops asking a provider once it is unregistered, and ignores a second unregister', () => {
    const unregister = add(() => ({ gone: true }));
    add(() => ({ stays: true }));
    unregister();
    unregister();
    expect(collectMetadata()).toEqual({ stays: true });
  });

  it('ignores a provider that is not a function', () => {
    expect(() => add('not a function' as unknown as () => unknown)).not.toThrow();
    expect(collectMetadata()).toBeNull();
  });
});
