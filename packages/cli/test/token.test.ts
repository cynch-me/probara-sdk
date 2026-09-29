/**
 * What SECURITY.md promises about the API token, end to end through the real CLI: it goes only to
 * the base URL, and no output shows it, not even a server message that echoes it back.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeProbara, type FakeProbara } from './support/fake-probara.js';
import { configuredEnv, runCli, TOKEN } from './support/run-cli.js';

let fake: FakeProbara;

beforeEach(async () => {
  fake = await startFakeProbara({ token: TOKEN });
});

afterEach(async () => {
  await fake.close();
});

/** A server error whose message and details hold the token, as a careless proxy might send. */
const ECHO = {
  status: 422,
  body: {
    error: { code: 'validation_failed', message: `bad token ${TOKEN}`, details: { token: TOKEN } },
  },
};

describe('the API token', () => {
  it('is sent only to the base URL, uploads included', async () => {
    const urls: string[] = [];
    const recording: typeof fetch = (input, init) => {
      urls.push(input instanceof Request ? input.url : String(input));
      return fetch(input, init);
    };

    const result = await runCli(['import', 'junit', 'playwright/junit.xml'], {
      env: configuredEnv(fake.baseUrl),
      fetch: recording,
    });

    expect(result.exitCode).toBe(0);
    // Every request carried the token (the fake answers 401 otherwise): the report, the uploads
    // and the close, and nothing else.
    expect(fake.requestsTo('stage').length).toBeGreaterThan(0);
    expect(urls).toHaveLength(fake.requests.length);
    for (const url of urls) expect(url.startsWith(`${fake.baseUrl}/api/`)).toBe(true);
  });

  it.each([
    ['import junit', ['import', 'junit', 'jest/junit.xml', '--max-retries', '0'], 'report'],
    ['run create', ['run', 'create', '--run-name', 'Nightly', '--max-retries', '0'], 'createRun'],
  ] as const)(
    'stays out of stderr, stdout and --json when the server echoes it (%s)',
    async (_name, args, route) => {
      fake.fail(route, ECHO);

      const text = await runCli([...args, '--debug'], { env: configuredEnv(fake.baseUrl) });
      const json = await runCli([...args, '--json'], { env: configuredEnv(fake.baseUrl) });

      for (const result of [text, json]) {
        expect(result.exitCode).toBe(1);
        // The message got through, with the token blanked out.
        expect(result.stderr).toContain('bad token [redacted]');
        expect(result.stderr).not.toContain(TOKEN);
        expect(result.stdout).not.toContain(TOKEN);
      }
      expect(JSON.stringify(JSON.parse(json.stdout))).toContain('[redacted]');
    },
  );

  it('stays out of the dry run of a report that holds it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'probara-cli-'));
    try {
      await writeFile(
        join(dir, 'leaky.xml'),
        `<testsuites><testsuite name="auth"><testcase classname="auth" name="logs in with ${TOKEN}"><failure message="expected ${TOKEN}"/></testcase></testsuite></testsuites>`,
      );
      const env = configuredEnv(fake.baseUrl);

      const lines = await runCli(['import', 'junit', 'leaky.xml', '--dry-run'], { env, cwd: dir });
      const json = await runCli(['import', 'junit', 'leaky.xml', '--dry-run', '--json'], {
        env,
        cwd: dir,
      });

      for (const result of [lines, json]) {
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('[redacted]');
        expect(result.stdout).not.toContain(TOKEN);
        expect(result.stderr).not.toContain(TOKEN);
      }
      expect(fake.requests).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
