/** Where core writes what it does. Messages never hold the API token. */
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const PREFIX = '[probara] ';

/**
 * A logger that writes to the console with a `[probara] ` prefix; debug lines only when asked.
 * With `stderr`, every level goes to stderr (`console.error`), for an adapter whose stdout belongs
 * to the test framework.
 */
export function createConsoleLogger(options: { debug: boolean; stderr?: boolean }): Logger {
  if (options.stderr === true) {
    const write = (message: string) => {
      console.error(`${PREFIX}${message}`);
    };
    return {
      debug: (message) => {
        if (options.debug) write(message);
      },
      info: write,
      warn: write,
      error: write,
    };
  }
  return {
    debug: (message) => {
      if (options.debug) console.debug(`${PREFIX}${message}`);
    },
    info: (message) => {
      console.log(`${PREFIX}${message}`);
    },
    warn: (message) => {
      console.warn(`${PREFIX}${message}`);
    },
    error: (message) => {
      console.error(`${PREFIX}${message}`);
    },
  };
}

/** A logger that writes nothing. */
export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const REDACTED = '[redacted]';

/** `text` with every occurrence of each non-empty secret replaced: a last line of defense. */
export function redact(text: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (result, secret) => (secret === '' ? result : result.split(secret).join(REDACTED)),
    text,
  );
}
