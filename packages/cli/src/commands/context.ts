import type { CliIO, CliLogger, Output } from '../io.js';

/** Calls `listener` with the signal that asks a recording to stop; returns the unsubscribe. */
export type StopSignals = (listener: (signal: string) => void) => () => void;

/** The process of one run, with what only a recording needs. */
export interface CommandIO extends CliIO {
  /**
   * The signals that stop `vis record` (SIGINT, SIGTERM): the bin listens to the process's. While a
   * recording runs, they end it and the recording is uploaded; outside one, they keep their default.
   */
  stopSignals?: StopSignals;
}

/** What every command runs with. */
export interface CommandContext {
  io: CommandIO;
  logger: CliLogger;
  output: Output;
}
