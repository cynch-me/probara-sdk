import type { CliIO, CliLogger, Output } from '../io.js';

/** What every command runs with. */
export interface CommandContext {
  io: CliIO;
  logger: CliLogger;
  output: Output;
}
