/** Runs the real CLI in-process, with captured output and the environment of a test. */
import { main } from '../../src/main.js';
import { FIXTURES_DIR } from '../fixtures.js';

/** A token that must never show up in any output. */
export const TOKEN = 'prb_test_T0KEN_must_never_leak_42';

export interface CliRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunCliOptions {
  /** The whole environment of the process: nothing from the real one leaks in. */
  env?: Record<string, string | undefined>;
  /** Defaults to the fixtures folder. */
  cwd?: string;
  now?: () => Date;
}

/** The environment of a configured CI job reporting to `baseUrl`. */
export function configuredEnv(
  baseUrl: string,
  extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    PROBARA_API_TOKEN: TOKEN,
    PROBARA_PROJECT: 'PRB',
    PROBARA_BASE_URL: baseUrl,
    ...extra,
  };
}

export async function runCli(
  args: readonly string[],
  options: RunCliOptions = {},
): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const exitCode = await main(args, {
    env: options.env ?? {},
    cwd: options.cwd ?? FIXTURES_DIR,
    stdout: {
      write: (text: string) => {
        stdout += text;
      },
    },
    stderr: {
      write: (text: string) => {
        stderr += text;
      },
    },
    // Retries do not wait in tests.
    sleep: () => Promise.resolve(),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return { exitCode, stdout, stderr };
}
