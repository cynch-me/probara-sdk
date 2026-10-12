import { describe, expect, it, vi } from 'vitest';

describe('watchRuns', () => {
  it('is one session for the process, also when the module is loaded again, as after a Vitest server restart', async () => {
    const first = (await import('./watch-runs.js')).watchRuns();
    vi.resetModules();
    const second = (await import('./watch-runs.js')).watchRuns();
    expect(second).toBe(first);
  });
});
