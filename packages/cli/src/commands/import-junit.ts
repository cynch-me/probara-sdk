/** `probara import junit <paths...>`: JUnit files into one Probara run, through core. */
import { createReporter, type ProbaraOptions } from '@probara/core';
import { resolveSetup, type Setup } from '../configuration.js';
import { EXIT_OK, EXIT_REPORTING_FAILED, EXIT_TESTS_FAILED, EXIT_USAGE } from '../exit-codes.js';
import { loadReports, matchFiles, type LoadedReport } from '../files.js';
import type { JUnitDialect } from '../junit/dialects.js';
import { stringOf, toCoreOptions, UsageError, type ParsedCommandLine } from '../options.js';
import type { CommandContext } from './context.js';
import {
  countTests,
  describeTests,
  logRunLeftOpen,
  logTarget,
  plural,
  printDryRun,
  reportingFailures,
  resultsFileOption,
  runtimeOf,
} from './reporting.js';

const HELP = 'probara import junit';
/** File lines of the pre-flight block at info; the rest are logged at debug. */
const MAX_LISTED_FILES = 10;

function filesOutput(reports: readonly LoadedReport[]) {
  return reports.map(({ path, dialect, results }) => ({ path, dialect, results: results.length }));
}

/**
 * The projects whose ids are read from test names: the project, then those of `--projects`; none
 * without a project. With reporting off, those it would report to.
 */
function projectCodesOf(setup: Setup): string[] {
  // Reporting off: a results file keeps the case links of the project it would report to.
  if (setup.kind === 'disabled') return setup.projectCodes;
  if (setup.kind !== 'ready' || setup.projectCode === undefined) return [];
  return [setup.projectCode, ...setup.config.projects.map((project) => project.projectId)];
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
    ...resultsFileOption(values, io),
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
  // Core's reporter resolves the same options and logs these warnings itself, but only when it runs
  // with reporting on (disabled, it logs them at debug): log them here on every other path (a dry
  // run, reporting off, an invalid setup, or an input error found first).
  const reporterWarns = !dryRun && setup.kind === 'ready';
  const logSetupWarnings = () => {
    for (const warning of setup.warnings) logger.warn(warning);
  };
  if (!reporterWarns) logSetupWarnings();
  if (setup.kind === 'invalid') {
    for (const problem of setup.problems) logger.error(problem);
    logger.error('Nothing was sent.');
    return EXIT_USAGE;
  }

  const matched = await matchFiles(positionals, io.cwd);
  if (matched.files.length === 0) {
    if (reporterWarns) logSetupWarnings();
    throw new UsageError(`No JUnit file matched ${positionals.join(', ')}`, HELP);
  }
  // Only when some file matched: otherwise the error above names every pattern, and a warning per
  // pattern would only repeat it.
  for (const pattern of matched.unmatched) logger.warn(`No file matched ${pattern}`);
  const dialect = stringOf(values, 'dialect');
  const { reports, errors } = await loadReports(matched.files, {
    cwd: io.cwd,
    dialect: dialect === undefined || dialect === 'auto' ? undefined : (dialect as JUnitDialect),
    projectCodes: projectCodesOf(setup),
    errorStatus: stringOf(values, 'error-status') as 'failed' | 'blocked' | undefined,
    attachOutput: values.get('attach-output') === true,
  });
  for (const error of errors) logger.error(error);
  if (errors.length > 0) {
    if (reporterWarns) logSetupWarnings();
    logger.error(
      `Nothing was sent: ${plural(errors.length, 'file')} could not be imported. ${errors.length === 1 ? 'Fix it or leave it out.' : 'Fix them or leave them out.'}`,
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
    return printDryRun(
      setup.config,
      results,
      {
        document: { files },
        fileCount: files.length,
        tests,
        json,
        routed: setup.projectCode !== undefined,
      },
      { logger, output },
    );
  }

  const reporterOptions = { ...options, ...runtimeOf(io, logger) };
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
