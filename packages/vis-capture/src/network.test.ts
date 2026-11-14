import { describe, expect, it } from 'vitest';
import { describeError, matchesUrl, replaceProperty } from './network.js';

describe('matchesUrl', () => {
  it('matches a string as a prefix and a RegExp anywhere, a global one included each time', () => {
    const patterns = ['https://api.probara.net/', /\/upload\//g];
    expect(matchesUrl('https://api.probara.net/v1/vises', patterns)).toBe(true);
    expect(matchesUrl('https://cdn.test/upload/1', patterns)).toBe(true);
    expect(matchesUrl('https://cdn.test/upload/2', patterns)).toBe(true);
    expect(matchesUrl('https://shop.test/api.probara.net/', patterns)).toBe(false);
  });
});

describe('replaceProperty', () => {
  it('puts back an own property, or removes the one it added over an inherited one', () => {
    const proto = { send: () => 'proto' };
    const object = Object.create(proto) as { send: () => string; own?: () => string };
    const own = () => 'own';
    object.own = own;
    const restoreSend = replaceProperty(object, 'send', () => 'wrapped');
    const restoreOwn = replaceProperty(object, 'own', () => 'wrapped');
    expect([object.send(), object.own()]).toEqual(['wrapped', 'wrapped']);
    restoreSend();
    restoreOwn();
    expect(Object.prototype.hasOwnProperty.call(object, 'send')).toBe(false);
    expect(object.send()).toBe('proto');
    expect(object.own).toBe(own);
  });

  it('leaves a value someone set after it in place', () => {
    const object: Record<string, unknown> = { fetch: 'original' };
    const restore = replaceProperty(object, 'fetch', 'ours');
    object['fetch'] = 'theirs';
    restore();
    expect(object['fetch']).toBe('theirs');
  });
});

describe('describeError', () => {
  it('gives the name and message of an error, and the text of anything else', () => {
    expect(describeError(new TypeError('Failed to fetch'))).toBe('TypeError: Failed to fetch');
    expect(describeError({ name: 'AbortError', message: '' })).toBe('AbortError');
    expect(describeError('offline')).toBe('offline');
    expect(
      describeError({
        toString() {
          throw new Error('hostile');
        },
      }),
    ).toBe('Error');
  });
});
