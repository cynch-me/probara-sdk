import { describe, expect, it, vi } from 'vitest';
import { runCli } from './support/run-cli.js';

// A created summary without its run cannot come from the HTTP client (it refuses such a body), so
// core's createRun is stubbed to check that the CLI still refuses to succeed without a ULID.
vi.mock('@probara/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@probara/core')>()),
  createRun: vi.fn(() => Promise.resolve({ status: 'created' })),
}));

describe('probara run create, when core answers created without the run', () => {
  it('exits 1 with a clear line and prints no ULID', async () => {
    const result = await runCli(['run', 'create'], {
      env: {
        PROBARA_API_TOKEN: 'prb_test_token',
        PROBARA_PROJECT: 'PRB',
        PROBARA_BASE_URL: 'http://127.0.0.1:9',
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      '[probara] The run was created, but Probara did not return it: there is no ULID to share. Check the runs of PRB before creating another.',
    );
  });
});
