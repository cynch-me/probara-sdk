import { describe, expect, it } from 'vitest';
import { messageData } from './websocket.js';

describe('messageData', () => {
  it('keeps text up to the cap and says how long the whole message was', () => {
    expect(messageData('{"a":1}', 10)).toBe('{"a":1}');
    expect(messageData('0123456789abc', 10)).toBe('0123456789… [truncated, 13 bytes]');
  });

  it('describes binary messages by their size', () => {
    expect(messageData(new ArrayBuffer(8), 10)).toBe('[binary message, 8 bytes]');
    expect(messageData(new Uint16Array(3), 10)).toBe('[binary message, 6 bytes]');
    expect(messageData(new Blob(['abc']), 10)).toBe('[binary message, 3 bytes]');
    expect(messageData(42, 10)).toBe('[unsupported message]');
  });
});
