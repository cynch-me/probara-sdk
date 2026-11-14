/**
 * The SDK's page side of the metadata handshake against the engine's reader, the code the
 * extension runs, on a real window.
 */
import { MAX_METADATA_BYTES, requestPageMetadata } from '@probara/vis-capture';
import { afterEach, describe, expect, it } from 'vitest';
import { metadata } from './metadata.js';

const registered: (() => void)[] = [];

afterEach(() => {
  for (const unregister of registered.splice(0)) unregister();
});

describe('the metadata handshake between the SDK and the extension reader', () => {
  it('reads the merged metadata the page registered, evaluated when asked', async () => {
    let cart = 1;
    registered.push(metadata(() => ({ user: 'u-1', cart })));
    registered.push(metadata(() => ({ plan: 'pro' })));
    cart = 3;
    await expect(requestPageMetadata({ timeoutMs: 200 })).resolves.toEqual({
      user: 'u-1',
      cart: 3,
      plan: 'pro',
    });
  });

  it('gets nothing once every provider is unregistered', async () => {
    const unregister = metadata(() => ({ user: 'u-1' }));
    unregister();
    await expect(requestPageMetadata({ timeoutMs: 50 })).resolves.toBeNull();
  });

  it('gets the providers that fit the limit, without the one that breaks it', async () => {
    registered.push(metadata(() => ({ kept: true })));
    registered.push(metadata(() => ({ huge: 'x'.repeat(MAX_METADATA_BYTES) })));
    await expect(requestPageMetadata({ timeoutMs: 200 })).resolves.toEqual({ kept: true });
  });
});
