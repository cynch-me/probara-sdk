/** `probara import junit <paths...>`: JUnit files into one Probara run, through core. */
import {
  createReporter,
  toReportEntry,
  type ProbaraOptions,
  type ReportResultEntry,
  type ReportSummary,
  type ResolvedConfig,
  type ResultStatus,
  type TestResultInput,
} from '@probara/core';
import { resolveSetup } from '../configuration.js';
import { EXIT_OK, EXIT_REPORTING_FAILED, EXIT_TESTS_FAILED, EXIT_USAGE } from '../exit-codes.js';
import { loadReports, matchFiles, type LoadedReport } from '../files.js';
import type { JUnitDialect } from '../junit/dialects.js';
import { stringOf, toCoreOptions, UsageError, type ParsedCommandLine } from '../options.js';
import type { CommandContext } from './context.js';

const HELP = 'probara import junit';
/** File lines of the pre-flight block at info; the rest are logged at debug. */
const MAX_LISTED_FILES = 10;

type Tests = Record<ResultStatus, number>;

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function countTests(results: readonly TestResultInput[]): Tests {
  const tests: Tests = { passed: 0, failed: 0, skipped: 0, blocked: 0 };
  for (const result of results) tests[result.status] += 1;
  return tests;
}

/** `(7 passed, 2 failed, 1 skipped, 0 blocked)` */
function describeTests(tests: Tests): string {
  return `(${tests.passed} passed, ${tests.failed} failed, ${tests.skipped} skipped, ${tests.blocked} blocked)`;
}

function filesOutput(reports: readonly LoadedReport[]) {
  return reports.map(({ path, dialect, results }) => ({ path, dialect, results: results.length }));
}

/** Exit 1 reasons: what failed at runtime, from core's summary. */
function reportingFailures(summary: ReportSummary): string[] {
  const reasons: string[] = [];
  if (summary.status === 'failed' || summary.status === 'partial') {
    reasons.push(`the report ${summary.status === 'failed' ? 'failed' : 'was partial'}`);
  } else if (summary.errors.length > 0) {
    reasons.push(plural(summary.errors.length, 'error'));
  }
  if (summary.invalid > 0) reasons.push(plural(summary.invalid, 'invalid result'));
  if (summary.attachments.failed > 0) {
    reasons.push(`${plural(summary.attachments.failed, 'attachment')} failed to upload`);
  }
  return reasons;
}

export async function importJunit(
  { values, positionals }: ParsedCommandLine,
  { io, logger, output }: CommandContext,
  clientName: string,
): Promise<number> {
  if (positionals.length === 0) {
    throw new UsageError('Missing the JUnit files (or globs, or directories) to import', HELP);
  }
  const dryRun = values.get('dry-run') === true;
  const json = values.get('json') === true;
  const options: ProbaraOptions = {
    rootDir: io.cwd,
    ...toCoreOptions('import junit', values, io.cwd),
    clientName,
    // A dry run shows what would be sent, whether or not reporting is turned on.
    ...(dryRun ? { enabled: true } : {}),
  };
  if (
    values.get('source') === false &&
    ['branch', 'commit', 'build-url'].some((name) => values.has(name))
  ) {
    logger.warn('Ignored --branch, --commit and --build-url: --no-source sends no source');
  }

  const setup = resolveSetup(options, io.env, { requireCredentials: !dryRun, now: io.now });
  logger.debugEnabled = setup.kind === 'ready' ? setup.config.debug : values.get('debug') === true;
  for (const warning of setup.warnings) logger.warn(warning);
  if (setup.kind === 'invalid') {
    for (const problem of setup.problems) logger.error(problem);
    logger.error('Nothing was sent.');
    return EXIT_USAGE;
  }

  const matched = await matchFiles(positionals, io.cwd);
  for (const pattern of matched.unmatched) logger.warn(`No file matched ${pattern}`);
  if (matched.files.length === 0) {
    throw new UsageError(`No JUnit file matched ${positionals.join(', ')}`, HELP);
  }
  const dialect = stringOf(values, 'dialect');
  const { reports, errors } = await loadReports(matched.files, {
    cwd: io.cwd,
    dialect: dialect === undefined || dialect === 'auto' ? undefined : (dialect as JUnitDialect),
    projectCode: setup.kind === 'ready' ? setup.projectCode : undefined,
    errorStatus: stringOf(values, 'error-status') as 'failed' | 'blocked' | undefined,
    attachOutput: values.get('attach-output') === true,
  });
  for (const error of errors) logger.error(error);
  if (errors.length > 0) {
    logger.error(
      `Nothing was sent: ${plural(errors.length, 'file')} could not be imported. Fix or leave out ${errors.length === 1 ? 'it' : 'them'}.`,
    );
    return EXIT_USAGE;
  }

  for (const report of reports) {
    for (const warning of report.warnings) logger.warn(warning);
  }
  const results = reports.flatMap((report) => report.results);
  const tests = countTests(results);
  const files = filesOutput(reports);
  logFiles(files, logger);
  logger.info(`Results: ${results.length} ${describeTests(tests)}`);
  if (results.length === 0) {
    logger.warn(`No testcase found in ${plural(reports.length, 'file')}: there is nothing to send`);
  }

  if (dryRun) {
    // A dry run resolves with reporting forced on, so it is never disabled.
    if (setup.kind !== 'ready') return EXIT_OK;
    logTarget(setup.config, setup.projectCode, logger);
    return printDryRun(setup.config, results, { files, tests, json }, { logger, output });
  }

  const reporterOptions = {
    ...options,
    logger,
    env: io.env,
    ...(io.fetch === undefined ? {} : { fetch: io.fetch }),
    ...(io.sleep === undefined ? {} : { sleep: io.sleep }),
    ...(io.now === undefined ? {} : { now: io.now }),
  };
  if (setup.kind === 'disabled') {
    logger.info(`${setup.reason}: nothing was sent`);
  } else if (results.length > 0) {
    logTarget(setup.config, setup.projectCode, logger);
  }
  const reporter = createReporter(reporterOptions);
  for (const result of results) reporter.addResult(result);
  const summary = await reporter.complete();

  const failures = reportingFailures(summary);
  const failedTests = tests.failed + tests.blocked;
  let exitCode = EXIT_OK;
  if (failures.length > 0) {
    exitCode = EXIT_REPORTING_FAILED;
    logger.error(`Exit 1: reporting to Probara failed (${failures.join(', ')})`);
    logRunLeftOpen(summary, setup.kind === 'ready' && 'ulid' in setup.config.run, logger);
  } else if (values.get('fail-on-failed-tests') === true && failedTests > 0) {
    exitCode = EXIT_TESTS_FAILED;
    logger.error(
      `Exit 3: ${plural(failedTests, 'result')} failed or blocked (--fail-on-failed-tests)`,
    );
  }
  if (json) output.json({ status: summary.status, exitCode, files, tests, summary });
  return exitCode;
}

/**
 * After exit 1: the run that stays open, and how to send into it instead of creating a new one.
 * A reused run was already given, so a re-run sends into it anyway, every result again.
 */
function logRunLeftOpen(
  summary: ReportSummary,
  reused: boolean,
  logger: CommandContext['logger'],
): void {
  const { run } = summary;
  if (run?.state !== 'open') return;
  const next = reused
    ? 'running the same command again sends every result into it again'
    : `--run-ulid ${run.ulid} imports into it instead of a new run`;
  logger.info(`The run ${run.displayId} (${run.url}) is still open: ${next}`);
}

function logFiles(files: ReturnType<typeof filesOutput>, logger: CommandContext['logger']): void {
  files.forEach(({ path, dialect, results }, index) => {
    const line = `${path}: ${dialect}, ${plural(results, 'result')}`;
    if (index < MAX_LISTED_FILES) logger.info(line);
    else logger.debug(line);
  });
  if (files.length > MAX_LISTED_FILES) {
    logger.info(
      `...and ${plural(files.length - MAX_LISTED_FILES, 'more file')} (--debug lists them)`,
    );
  }
}

/** Where the results go: never the token. */
function logTarget(
  config: ResolvedConfig,
  projectCode: string | undefined,
  logger: CommandContext['logger'],
): void {
  logger.info(`Project: ${projectCode ?? '(none: ids in test names are not linked)'}`);
  logger.info(
    'ulid' in config.run
      ? `Run: ${config.run.ulid} (existing run)`
      : `Run: new run "${config.run.name}"`,
  );
  logger.info(`Base URL: ${config.baseUrl}`);
  logger.info(`Missing cases: ${config.createMissingCases ? 'created' : 'not created'}`);
  logger.info(`Attachments: ${config.uploadAttachments ? 'on' : 'off'}`);
}

function printDryRun(
  config: ResolvedConfig,
  results: readonly TestResultInput[],
  imported: { files: ReturnType<typeof filesOutput>; tests: Tests; json: boolean },
  { logger, output }: Pick<CommandContext, 'logger' | 'output'>,
): number {
  const entries: ReportResultEntry[] = [];
  let invalid = 0;
  for (const result of results) {
    try {
      const conversion = toReportEntry(result, { rootDir: config.rootDir });
      for (const warning of conversion.warnings) logger.warn(warning);
      entries.push(conversion.entry);
    } catch (error) {
      // A real import counts it as invalid and exits 1: so does the dry run.
      invalid += 1;
      logger.warn(
        `Skipped an invalid result: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const exitCode = invalid > 0 ? EXIT_REPORTING_FAILED : EXIT_OK;
  const { files, tests } = imported;
  if (imported.json) {
    output.json({ dryRun: true, exitCode, files, tests, invalid, entries });
  } else {
    for (const entry of entries) {
      output.line(`${entry.status}\t${entry.caseDisplayId ?? '-'}\t${entry.automationKey ?? ''}`);
    }
    output.line(
      `Total: ${plural(entries.length, 'result')} from ${plural(files.length, 'file')} ${describeTests(tests)}`,
    );
  }
  logger.info('Dry run: nothing was sent');
  if (invalid > 0) {
    logger.error(`Exit 1: ${plural(invalid, 'invalid result')} that a real import would not send`);
  }
  return exitCode;
}
