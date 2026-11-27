interface RandomSource {
  getRandomValues?(array: Uint8Array): Uint8Array;
}

/** 32 lowercase hex characters: an event id, or a session id. */
export function randomId(): string {
  const bytes = new Uint8Array(16);
  const crypto = (globalThis as { crypto?: RandomSource }).crypto;
  if (typeof crypto?.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
