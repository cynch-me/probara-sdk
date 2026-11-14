/**
 * The options and the configuration the Vis commands share with the other commands: the Vis
 * commands added options, a value type and a setup without a project, and the other commands keep
 * what they did.
 */
import type { CreateRunRequest } from '@probara/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { configuredEnv, runCli, TOKEN } from './support/run-cli.js';

let fake: FakeProbara;

beforeEach(async () => {
  fake = await startFakeProbara({ token: TOKEN });
});

afterEach(async () => {
  await fake.close();
});

describe('the commands that share code with the Vis commands', () => {
  it('still require the project to create a run', async () => {
    const result = await runCli(['run', 'create'], {
      env: { PROBARA_API_TOKEN: TOKEN, PROBARA_BASE_URL: fake.baseUrl },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      'The project is not set: pass --project or set PROBARA_PROJECT',
    );
    expect(fake.requestsTo('createRun')).toHaveLength(0);
  });

  it('still take --no-source and split --tag at commas', async () => {
    const result = await runCli(['run', 'create', '--no-source', '--tag', 'a,b', '--json'], {
      env: configuredEnv(fake.baseUrl, { PROBARA_BRANCH: 'main' }),
    });

    expect(result.exitCode).toBe(0);
    const body = fake.requestsTo('createRun')[0]?.body as CreateRunRequest;
    expect(body.tags).toEqual(['a', 'b']);
    expect(body).not.toHaveProperty('source');
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'created' });
  });
});
