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
/**
 * A test failed or was blocked, or an unhandled error was left out (Vitest 5), and
 * `--fail-on-failed-tests` was given (1 and 2 win).
 */
export const EXIT_TESTS_FAILED = 3;
/** The commands that take `--fail-on-failed-tests`, so the only ones that exit 3. */
export const FAILS_ON_TESTS: readonly CommandName[] = ['import junit', 'import cucumber'];

export interface ExitCode {
  code: number;
  meaning: string;
  /** The commands that exit with it, when not every command does. */
  commands?: readonly CommandName[];
}

/** The Vis commands that only read or change a Vis. */
const VIS_CHANGES: readonly CommandName[] = ['vis list', 'vis get', 'vis update'];
/** The recording-link commands that read, create or change a link. */
const LINK_CHANGES: readonly CommandName[] = [
  'vis recording-links list',
  'vis recording-links get',
  'vis recording-links create',
  'vis recording-links update',
];
/** The recording-link commands that ask for a confirmation. */
const LINK_ENDS: readonly CommandName[] = [
  'vis recording-links revoke',
  'vis recording-links delete',
];

export const EXIT_CODES: readonly ExitCode[] = [
  {
    code: EXIT_OK,
    commands: ['snap finalize'],
    meaning: 'Done (the build is finalized, or already was); or disabled by PROBARA_ENABLED=false.',
  },
  {
    code: EXIT_REPORTING_FAILED,
    commands: ['snap finalize'],
    meaning:
      'Probara refused the request (the log says why: 404 when no build has this name and nonce, 409 when no machine sent its screenshots yet or the build failed or expired, 422 when the build has a shard total), or could not be reached after the retries.',
  },
  {
    code: EXIT_USAGE,
    commands: ['snap finalize'],
    meaning:
      'Usage or configuration error (unknown option, not configured, no nonce and none the CI gives). Nothing was sent.',
  },
  {
    code: EXIT_OK,
    commands: ['import junit', 'import cucumber', 'run create', 'run close'],
    meaning:
      'Done (reported, created or closed); or disabled by PROBARA_ENABLED=false; or a dry run.',
  },
  {
    code: EXIT_OK,
    commands: ['import results'],
    meaning:
      'Done (reported); or no results file matched (nothing was left unsent); or disabled by PROBARA_ENABLED=false; or a dry run.',
  },
  {
    code: EXIT_REPORTING_FAILED,
    commands: ['import junit', 'import cucumber'],
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
    commands: ['import junit', 'run create', 'run close'],
    meaning:
      'Usage, configuration or input error (unknown option, invalid value, not configured, no file matched, invalid XML). Nothing was sent.',
  },
  {
    code: EXIT_USAGE,
    commands: ['import cucumber'],
    meaning:
      'Usage, configuration or input error (unknown option, invalid value, not configured, no file matched, a file that is not valid Cucumber JSON, a feature file that does not parse). Nothing was sent.',
  },
  {
    code: EXIT_USAGE,
    commands: ['import results'],
    meaning:
      'Usage, configuration or input error (unknown option, invalid value, not configured, a directory, a file that cannot be read or is not a results file). Nothing was sent: every file is checked first.',
  },
  {
    code: EXIT_TESTS_FAILED,
    commands: FAILS_ON_TESTS,
    meaning:
      'A test failed or was blocked, or an unhandled error was left out (Vitest 5), and --fail-on-failed-tests was given. Codes 1 and 2 win.',
  },
  {
    code: EXIT_OK,
    commands: ['sync gherkin'],
    meaning:
      'Done: the scenarios were synced (with --dry-run, the outcome was computed and nothing was written); or disabled by PROBARA_ENABLED=false.',
  },
  {
    code: EXIT_REPORTING_FAILED,
    commands: ['sync gherkin'],
    meaning:
      'Probara refused the sync, or could not be reached after the retries. A sync that Probara refuses writes nothing: fix the cause and run it again.',
  },
  {
    code: EXIT_USAGE,
    commands: ['sync gherkin'],
    meaning:
      'Usage, configuration or input error (unknown option, invalid value, not configured, no file matched, a file that does not parse or is outside --root-dir, a step keyword that is not English, two scenarios with one automation key, more than 1,000 scenarios or 20 globs). Nothing was sent.',
  },
  {
    code: EXIT_OK,
    commands: [...VIS_CHANGES, 'vis create', 'vis delete', ...LINK_CHANGES, ...LINK_ENDS],
    meaning: 'Done; or disabled by PROBARA_ENABLED=false: nothing was sent.',
  },
  {
    code: EXIT_OK,
    commands: ['vis record'],
    meaning:
      'Done: the recording is a Vis; or disabled by PROBARA_ENABLED=false: nothing was recorded or sent.',
  },
  {
    code: EXIT_REPORTING_FAILED,
    commands: ['vis record'],
    meaning:
      'The browser could not be reached or the recording failed; or nothing was captured, or a signal came before the recording started, and no Vis was created; or Probara refused the Vis or an upload (the log says why), or could not be reached after the retries. A Vis whose upload failed was deleted again, unless the log says Probara could not be reached for that either: Probara then deletes it seven days after its creation.',
  },
  {
    code: EXIT_USAGE,
    commands: ['vis record'],
    meaning:
      'Usage or configuration error (unknown option, invalid value, not configured, no --cdp, a browser with several pages and no --target, a --target that matches no page or several). Nothing was recorded or sent.',
  },
  {
    code: EXIT_REPORTING_FAILED,
    commands: VIS_CHANGES,
    meaning:
      'Probara refused the request (the log says why, such as 404 for a Vis you cannot see), or could not be reached after the retries.',
  },
  {
    code: EXIT_REPORTING_FAILED,
    commands: ['vis create'],
    meaning:
      'Probara refused the Vis or an upload (the log says why), or could not be reached after the retries. The pending Vis was deleted again, unless the log says Probara could not be reached for that either: Probara then deletes it seven days after its creation.',
  },
  {
    code: EXIT_REPORTING_FAILED,
    commands: ['vis delete'],
    meaning:
      'Probara refused the deletion or could not be reached after the retries, or the deletion was not confirmed. Nothing was deleted.',
  },
  {
    code: EXIT_USAGE,
    commands: VIS_CHANGES,
    meaning:
      'Usage or configuration error (unknown option, invalid value, an id that is not a ULID or a VIS-<n> display ID, not configured). Nothing was sent.',
  },
  {
    code: EXIT_USAGE,
    commands: ['vis create'],
    meaning:
      'Usage, configuration or input error (unknown option, invalid value, not configured, a file that cannot be read or is not an MP4, WebM, PNG, JPEG or WebP file, a video whose length the file does not record and no --duration-ms, a Playwright trace that cannot be read). Nothing was sent.',
  },
  {
    code: EXIT_USAGE,
    commands: ['vis delete'],
    meaning:
      'Usage or configuration error (unknown option, an id that is not a ULID or a VIS-<n> display ID, not configured, no --yes when stdin is not a terminal). Nothing was deleted.',
  },
  {
    code: EXIT_REPORTING_FAILED,
    commands: LINK_CHANGES,
    meaning:
      'Probara refused the request (the log says why, such as 404 for a link you do not manage, 409 for a revoked link or past the recording links of the plan), or could not be reached after the retries.',
  },
  {
    code: EXIT_REPORTING_FAILED,
    commands: LINK_ENDS,
    meaning:
      'Probara refused the request or could not be reached after the retries, or it was not confirmed. The link was left as it was.',
  },
  {
    code: EXIT_USAGE,
    commands: LINK_CHANGES,
    meaning:
      'Usage or configuration error (unknown option, invalid value, an id that is not a ULID, no --title for create, an --expires in the past, nothing to change, not configured). Nothing was sent.',
  },
  {
    code: EXIT_USAGE,
    commands: LINK_ENDS,
    meaning:
      'Usage or configuration error (unknown option, an id that is not a ULID, not configured, no --yes when stdin is not a terminal). The link was left as it was.',
  },
];
