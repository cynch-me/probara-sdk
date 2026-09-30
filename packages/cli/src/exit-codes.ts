/** The exit codes of every command. */
import type { CommandName } from './options.js';

/** Reported; or disabled by `PROBARA_ENABLED=false`; or a dry run. */
export const EXIT_OK = 0;
/**
 * Reporting to Probara failed at runtime. Re-running is not always safe: an import creates a new
 * run unless `--run-ulid` is given, and a failed create may have created a run.
 */
export const EXIT_REPORTING_FAILED = 1;
/** A usage, configuration or input error: nothing was sent, fix the command. */
export const EXIT_USAGE = 2;
/** Tests failed or were blocked, and `--fail-on-failed-tests` was given (1 and 2 win). */
export const EXIT_TESTS_FAILED = 3;
/** The commands that take `--fail-on-failed-tests`, so the only ones that exit 3. */
export const FAILS_ON_TESTS: readonly CommandName[] = ['import junit'];

export interface ExitCode {
  code: number;
  meaning: string;
  /** The commands that exit with it, when not every command does. */
  commands?: readonly CommandName[];
}

export const EXIT_CODES: readonly ExitCode[] = [
  {
    code: EXIT_OK,
    meaning:
      'Done (reported, created or closed); or disabled by PROBARA_ENABLED=false; or a dry run.',
  },
  {
    code: EXIT_REPORTING_FAILED,
    commands: ['import junit'],
    meaning:
      'Reporting to Probara failed (a failed or partial report, invalid results, failed uploads, a failed close). Read the log before re-running: a re-run creates a new run unless --run-ulid is given, and results sent again into the same run are recorded again (each run case keeps the last outcome).',
  },
  {
    code: EXIT_REPORTING_FAILED,
    commands: ['import results'],
    meaning:
      'Reporting to Probara failed (a failed or partial report, invalid results, failed uploads, a failed close). Read the log before re-running: results sent again into the same run are recorded again (each run case keeps the last outcome); a results file keeps what was not sent (--results-file, or the file import results sends).',
  },
  {
    code: EXIT_REPORTING_FAILED,
    commands: ['run create', 'run close'],
    meaning:
      'Reporting to Probara failed (the create or the close failed). Read the log before re-running: a failed create may have created a run.',
  },
  {
    code: EXIT_USAGE,
    meaning:
      'Usage, configuration or input error (unknown option, invalid value, not configured, no file matched, invalid XML, not a results file). Nothing was sent.',
  },
  {
    code: EXIT_TESTS_FAILED,
    commands: FAILS_ON_TESTS,
    meaning:
      'A test failed or was blocked, and --fail-on-failed-tests was given. Codes 1 and 2 win.',
  },
];
