/** The exit codes of every command. */

/** Reported; or disabled by `PROBARA_ENABLED=false`; or a dry run. */
export const EXIT_OK = 0;
/** Reporting to Probara failed at runtime: retrying may help. */
export const EXIT_REPORTING_FAILED = 1;
/** A usage, configuration or input error: nothing was sent, fix the command. */
export const EXIT_USAGE = 2;
/** Tests failed or were blocked, and `--fail-on-failed-tests` was given (1 and 2 win). */
export const EXIT_TESTS_FAILED = 3;

export const EXIT_CODES: readonly { code: number; meaning: string }[] = [
  { code: EXIT_OK, meaning: 'Reported; or disabled by PROBARA_ENABLED=false; or a dry run.' },
  {
    code: EXIT_REPORTING_FAILED,
    meaning:
      'Reporting to Probara failed (a failed or partial report, invalid results, failed uploads, a failed create or close). Retrying may help.',
  },
  {
    code: EXIT_USAGE,
    meaning:
      'Usage, configuration or input error (unknown option, invalid value, not configured, no file matched, invalid XML). Nothing was sent.',
  },
  {
    code: EXIT_TESTS_FAILED,
    meaning:
      'A test failed or was blocked, and --fail-on-failed-tests was given. Codes 1 and 2 win.',
  },
];
