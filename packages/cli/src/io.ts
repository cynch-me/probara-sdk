/** Where the CLI writes: logs on stderr, machine output on stdout. The token never reaches either. */
import { redact, type Logger } from '@probara/core';

export interface Writable {
  write(text: string): unknown;
}

/** The process around one run of the CLI: tests pass their own. */
export interface CliIO {
  /** The environment `PROBARA_*` and CI variables are read from. */
  env: Readonly<Record<string, string | undefined>>;
  /** The directory relative paths and globs start at. */
  cwd: string;
  /** Machine output only: `--json`, `--dry-run` entries, `run create`'s ULID, help and version. */
  stdout: Writable;
  /** Every log line. */
  stderr: Writable;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Waits between retries. Defaults to a timer. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** The clock of the default run name. */
  now?: () => Date;
}

const PREFIX = '[probara] ';

/** A logger on stderr with core's prefix, whose debug lines show once debug is turned on. */
export interface CliLogger extends Logger {
  debugEnabled: boolean;
}

/** The secrets to keep out of every output: the token of the environment. */
export function secretsOf(env: CliIO['env']): string[] {
  const token = env.PROBARA_API_TOKEN?.trim();
  return token === undefined || token === '' ? [] : [token];
}

export function createCliLogger(stderr: Writable, secrets: readonly string[]): CliLogger {
  const write = (message: string) => {
    stderr.write(`${PREFIX}${redact(message, secrets)}\n`);
  };
  const logger: CliLogger = {
    debugEnabled: false,
    // Core hands every debug line to a custom logger: the level is filtered here.
    debug: (message) => {
      if (logger.debugEnabled) write(message);
    },
    info: write,
    warn: write,
    error: write,
  };
  return logger;
}

/** Writes machine output on stdout, without the token. */
export function createOutput(stdout: Writable, secrets: readonly string[]) {
  return {
    line(text: string): void {
      stdout.write(`${redact(text, secrets)}\n`);
    },
    json(value: unknown): void {
      stdout.write(`${redact(JSON.stringify(value, null, 2), secrets)}\n`);
    },
  };
}

export type Output = ReturnType<typeof createOutput>;
