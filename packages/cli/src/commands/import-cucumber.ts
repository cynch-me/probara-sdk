/**
 * `probara import cucumber <paths...>`: Cucumber JSON reports, sent as the results of the scenarios
 * they ran, through core. Every file is read and checked before anything is sent.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createReporter, type ProbaraOptions, type TestResultInput } from '@probara/core';
import { resolveSetup } from '../configuration.js';
import { cucumberFeaturesOf, resultsOfCucumber, type CucumberReading } from '../cucumber/json.js';
import { EXIT_OK, EXIT_REPORTING_FAILED, EXIT_TESTS_FAILED, EXIT_USAGE } from '../exit-codes.js';
import { displayPath, matchFiles } from '../files.js';
import { toCoreOptions, UsageError, type ParsedCommandLine } from '../options.js';
import type { CommandContext } from './context.js';
import {
  countTests,
  describeTests,
  logRunLeftOpen,
  logTarget,
  plural,
  printDryRun,
  reportingFailures,
  runtimeOf,
} from './reporting.js';

const HELP = 'probara import cucumber';

/** The file of a feature, read under the root directory; `undefined` when it is not there. */
function featureReader(rootDir: string) {
  return async (path: string): Promise<string | undefined> => {
    try {
      return await readFile(join(rootDir, path), 'utf8');
    } catch {
      return undefined;
    }
  };
}

export async function importCucumber(
  { values, positionals }: ParsedCommandLine,
  { io, logger, output }: CommandContext,
  clientName: string,
): Promise<number> {
  if (positionals.length === 0) {
    throw new UsageError(
      'Missing the Cucumber JSON files (or globs, or directories) to import',
      HELP,
    );
  }
  const dryRun = values.get('dry-run') === true;
  const json = values.get('json') === true;
  const options: ProbaraOptions = {
    rootDir: io.cwd,
    ...toCoreOptions('import cucumber', values, io.cwd),
    clientName,
    // A dry run shows what would be sent, whether or not reporting is turned on.
    ...(dryRun ? { enabled: true } : {}),
  };
  const rootDir = options.rootDir ?? io.cwd;
  if (
    values.get('source') === false &&
    ['branch', 'commit', 'build-url'].some((name) => values.has(name))
  ) {
    logger.warn('Ignored --branch, --commit and --build-url: --no-source sends no source');
  }

  const setup = resolveSetup(options, io.env, { requireCredentials: !dryRun, now: io.now });
  logger.debugEnabled = setup.kind === 'ready' ? setup.config.debug : values.get('debug') === true;
  // Core's reporter logs these warnings itself, but only when it runs with reporting on.
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

  const matched = await matchFiles(positionals, io.cwd, { directoryGlob: '**/*.json' });
  if (matched.files.length === 0) {
    if (reporterWarns) logSetupWarnings();
    throw new UsageError(`No Cucumber JSON file matched ${positionals.join(', ')}`, HELP);
  }
  for (const pattern of matched.unmatched) logger.warn(`No file matched ${pattern}`);

  const readFeature = featureReader(rootDir);
  const errors: string[] = [];
  const loaded: { path: string; reading: CucumberReading }[] = [];
  for (const file of matched.files) {
    const path = displayPath(file, io.cwd);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      errors.push(
        `${path}: could not be read (${typeof code === 'string' ? code : String(error)})`,
      );
      continue;
    }
    const read = cucumberFeaturesOf(text);
    if (!read.ok) {
      errors.push(`${path}: ${read.error}`);
      continue;
    }
    const reading = await resultsOfCucumber(read.features, { rootDir, readFeature });
    errors.push(...reading.errors);
    loaded.push({ path, reading });
  }
  if (errors.length > 0) {
    for (const error of errors) logger.error(error);
    if (reporterWarns) logSetupWarnings();
    logger.error(`Nothing was sent: ${plural(errors.length, 'problem')} to fix first.`);
    return EXIT_USAGE;
  }

  for (const { reading } of loaded) {
    for (const note of reading.notes) logger.info(note);
    for (const warning of reading.warnings) logger.warn(warning);
  }
  const results: TestResultInput[] = loaded.flatMap(({ reading }) => reading.results);
  const tests = countTests(results);
  const files = loaded.map(({ path, reading }) => ({ path, results: reading.results.length }));
  for (const { path, results: count } of files) {
    logger.info(`${path}: ${plural(count, 'result')}`);
  }
  logger.info(`Results: ${results.length} ${describeTests(tests)}`);
  if (results.length === 0) {
    logger.warn(`No scenario found in ${plural(loaded.length, 'file')}: there is nothing to send`);
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
