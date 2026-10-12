import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runningTestOf } from './browser-setup.js';

describe("the browser setup's running test", () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers the running test, and nothing between two tests', () => {
    const test = { name: 'totals the cart', meta: {} };
    expect(runningTestOf(() => test)).toBe(test);
    expect(runningTestOf(() => undefined)).toBeUndefined();
  });

  it('answers nothing, with one warning, when Vitest moves the accessor, and never throws into the test', () => {
    const moved = () => {
      throw new Error('getCurrentTest moved');
    };
    expect(runningTestOf(moved)).toBeUndefined();
    expect(runningTestOf(moved)).toBeUndefined();
    expect(vi.mocked(console.warn).mock.calls).toEqual([
      ['[probara] the probara.* helpers cannot see the running test: getCurrentTest moved'],
    ]);
  });
});
