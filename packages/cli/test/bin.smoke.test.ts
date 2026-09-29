/** The built bin (`dist/cli.js`), spawned like a CI step would run it. `globalSetup` builds it. */
import { spawn } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURES_DIR } from './fixtures.js';
import { startFakeProbara, type FakeProbara } from './support/fake-probara.js';
import { configuredEnv, TOKEN, type CliRun } from './support/run-cli.js';

const BIN = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function spawnBin(
  args: readonly string[],
  env: Record<string, string | undefined>,
): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: FIXTURES_DIR,
      // Only what the test sets, plus PATH: no CI variable of the machine leaks in.
      env: { PATH: process.env.PATH, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

let fake: FakeProbara;

beforeEach(async () => {
  fake = await startFakeProbara({ token: TOKEN });
});

afterEach(async () => {
  await fake.close();
});

describe('the built probara bin', () => {
  it('is an executable node script', () => {
    expect(readFileSync(BIN, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(() => {
      accessSync(BIN, constants.X_OK);
    }).not.toThrow();
  });

  it('prints its help', async () => {
    const result = await spawnBin(['import', 'junit', '--help'], {});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: probara import junit [options] <paths...>');
  });

  it('imports a report into the fake Probara and exits 0', async () => {
    const result = await spawnBin(
      ['import', 'junit', 'jest/junit.xml'],
      configuredEnv(fake.baseUrl),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[probara] Recorded 10 results');
    expect(result.stderr).not.toContain(TOKEN);
    expect(fake.reports()).toHaveLength(1);
  });

  it('exits 3 with --fail-on-failed-tests, 2 on a usage error and 1 when reporting fails', async () => {
    const env = configuredEnv(fake.baseUrl);
    const failedTests = await spawnBin(
      ['import', 'junit', 'jest/junit.xml', '--fail-on-failed-tests'],
      env,
    );
    const usage = await spawnBin(['import', 'junit', 'jest/junit.xml', '--token', 'x'], env);
    fake.fail('report', { status: 500 });
    const failedReport = await spawnBin(
      ['import', 'junit', 'jest/junit.xml', '--max-retries', '0'],
      env,
    );

    expect([failedTests.exitCode, usage.exitCode, failedReport.exitCode]).toEqual([3, 2, 1]);
  });

  it('prints a JSON document that parses', async () => {
    const result = await spawnBin(
      ['import', 'junit', 'gotestsum/junit.xml', '--json'],
      configuredEnv(fake.baseUrl),
    );

    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'completed', exitCode: 0 });
  });
});
