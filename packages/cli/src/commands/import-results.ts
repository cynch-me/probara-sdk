/** `probara import results <file>`: a results file sent again, through core. */
import { resolve } from 'node:path';
import {
  createReporter,
  readResultsFile,
  type ProbaraOptions,
  type RunSource,
} from '@probara/core';
import { resolveSetup } from '../configuration.js';
import { EXIT_OK, EXIT_REPORTING_FAILED, EXIT_USAGE } from '../exit-codes.js';
import { displayPath } from '../files.js';
import type { CliIO } from '../io.js';
import { optionsOf, toCoreOptions, UsageError, type ParsedCommandLine } from '../options.js';
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

const HELP = 'probara import results';

/**
 * The settings of the file whose `PROBARA_*` variable is not set: the variables win over the file,
 * as flags win over both. The option paths and their variables come from the options registry.
 */
function fileSettingsUnder(file: ProbaraOptions, env: CliIO['env']): ProbaraOptions {
  const overridden = new Set<string | undefined>(
    optionsOf('import results')
      .filter((spec) => spec.env !== undefined && (env[spec.env]?.trim() ?? '') !== '')
      .map((spec) => spec.core),
  );
  const fieldsOf = (group: string, value: unknown): unknown =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).filter(([field]) => !overridden.has(`${group}.${field}`)),
        )
      : value;
  return Object.fromEntries(
    Object.entries(file)
      .filter(([key]) => !overridden.has(key))
      .map(([key, value]) => [
        key,
        key === 'run' || key === 'source' ? fieldsOf(key, value) : value,
      ]),
  );
}

/** The flags over the settings of the file, the run and the source field by field. */
function merge(file: ProbaraOptions, flags: ProbaraOptions): ProbaraOptions {
  const run = { ...file.run, ...flags.run };
  const source: RunSource | false | undefined =
    flags.source === false
      ? false
      : file.source === undefined && flags.source === undefined
        ? undefined
        : { ...(file.source || {}), ...(flags.source || {}) };
  return {
    ...file,
    ...flags,
    ...(Object.keys(run).length === 0 ? {} : { run }),
    ...(source === undefined ? {} : { source }),
  };
}

export async function importResults(
  { values, positionals }: ParsedCommandLine,
  { io, logger, output }: CommandContext,
  clientName: string,
): Promise<number> {
  const [given, extra] = positionals;
  if (given === undefined) throw new UsageError('Missing the results file to import', HELP);
  if (extra !== undefined) throw new UsageError('Import one results file at a time', HELP);
  const dryRun = values.get('dry-run') === true;
  const json = values.get('json') === true;
  const flags = toCoreOptions('import results', values, io.cwd);
  if (
    values.get('source') === false &&
    ['branch', 'commit', 'build-url'].some((name) => values.has(name))
  ) {
    logger.warn('Ignored --branch, --commit and --build-url: --no-source sends no source');
  }

  const path = resolve(io.cwd, given);
  const shown = displayPath(path, io.cwd);
  const reading = await readResultsFile(path);
  if (!reading.ok) {
    logger.error(reading.error.replace(path, shown));
    logger.error('Nothing was sent.');
    return EXIT_USAGE;
  }
  const options: ProbaraOptions = {
    rootDir: io.cwd,
    ...merge(fileSettingsUnder(reading.options, io.env), flags),
    ...resultsFileOption(values, io),
    clientName,
    // A dry run shows what would be sent, whether or not reporting is turned on.
    ...(dryRun ? { enabled: true } : {}),
  };

  const setup = resolveSetup(options, io.env, { requireCredentials: !dryRun, now: io.now });
  logger.debugEnabled = setup.kind === 'ready' ? setup.config.debug : values.get('debug') === true;
  // Core's reporter logs these warnings itself when it runs with reporting on.
  if (dryRun || setup.kind !== 'ready') {
    for (const warning of setup.warnings) logger.warn(warning);
  }
  if (setup.kind === 'invalid') {
    for (const problem of setup.problems) logger.error(problem);
    logger.error('Nothing was sent.');
    return EXIT_USAGE;
  }

  const { results } = reading;
  const tests = countTests(results);
  const document = { file: { path: shown, results: results.length } };
  logger.info(`${shown}: ${plural(results.length, 'result')}`);
  logger.info(`Results: ${results.length} ${describeTests(tests)}`);
  if (results.length === 0)
    logger.warn('The results file holds no result: there is nothing to send');

  if (dryRun) {
    // A dry run resolves with reporting forced on, so it is never disabled.
    if (setup.kind !== 'ready') return EXIT_OK;
    logTarget(setup.config, setup.projectCode, logger);
    return printDryRun(
      setup.config,
      results,
      { document, fileCount: 1, tests, json, routed: setup.projectCode !== undefined },
      { logger, output },
    );
  }

  if (setup.kind === 'disabled') logger.info(`${setup.reason}: nothing was sent`);
  else if (results.length > 0) logTarget(setup.config, setup.projectCode, logger);
  const reporter = createReporter({ ...options, ...runtimeOf(io, logger) });
  for (const result of results) reporter.addResult(result);
  const summary = await reporter.complete();

  const failures = reportingFailures(summary);
  let exitCode = EXIT_OK;
  if (failures.length > 0) {
    exitCode = EXIT_REPORTING_FAILED;
    logger.error(`Exit 1: reporting to Probara failed (${failures.join(', ')})`);
    logRunLeftOpen(summary, setup.kind === 'ready' && 'ulid' in setup.config.run, logger);
  }
  if (json) output.json({ status: summary.status, exitCode, ...document, tests, summary });
  return exitCode;
}
