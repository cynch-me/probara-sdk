/**
 * `probara import results <paths...>`: results files sent again, through core, each on its own and
 * consumed once sent.
 */
import { access, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  attachmentsFolderOf,
  createReporter,
  readResultsFile,
  type ProbaraOptions,
  type ReportSummary,
  type RunSource,
  type TestResultInput,
} from '@probara/core';
import { resolveSetup, type Setup } from '../configuration.js';
import { EXIT_OK, EXIT_REPORTING_FAILED, EXIT_USAGE } from '../exit-codes.js';
import { bySiblingNumber, displayPath, matchFiles } from '../files.js';
import type { CliIO } from '../io.js';
import { optionsOf, toCoreOptions, UsageError, type ParsedCommandLine } from '../options.js';
import type { CommandContext } from './context.js';
import {
  countTests,
  describeTests,
  dryRunOf,
  dryRunTotal,
  endDryRun,
  logRunLeftOpen,
  logTarget,
  plural,
  reportingFailures,
  runtimeOf,
  type DryRun,
  type Tests,
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

/**
 * Deletes a results file every result of which was sent, and the folder of its bodies, so it is
 * never sent twice.
 */
async function deleteSent(
  path: string,
  cwd: string,
  logger: CommandContext['logger'],
): Promise<void> {
  const shown = displayPath(path, cwd);
  const folder = attachmentsFolderOf(path);
  const hasFolder = await access(folder).then(
    () => true,
    () => false,
  );
  try {
    await rm(path, { force: true });
    if (hasFolder) await rm(folder, { recursive: true, force: true });
    const deleted = hasFolder ? `${shown} and ${displayPath(folder, cwd)}` : shown;
    logger.info(`Deleted ${deleted}: every result was sent`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Could not delete ${shown}: ${message}. Delete it now: every result in it was sent, and importing it again would send them twice`,
    );
  }
}

/** Whether `path` is a file of zero bytes. */
async function isEmpty(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size === 0;
  } catch {
    // One that cannot be read is named when it is read.
    return false;
  }
}

/** A results file read and checked, ready to send. */
interface LoadedFile {
  path: string;
  /** The path as logs and output name it. */
  shown: string;
  results: TestResultInput[];
  tests: Tests;
  options: ProbaraOptions;
  setup: Exclude<Setup, { kind: 'invalid' }>;
}

/** What `--json` says of one file that was sent. */
interface SentFile {
  path: string;
  results: number;
  status: ReportSummary['status'];
  tests: Tests;
  summary: ReportSummary;
}

/**
 * Sends one file, and consumes it: deleted once every result was sent, rewritten with only the
 * results still unsent otherwise (core writes it back atomically). With reporting off, it is left.
 */
async function sendFile(
  file: LoadedFile,
  { io, logger }: Pick<CommandContext, 'io' | 'logger'>,
): Promise<{ sent: SentFile; failures: string[] }> {
  const { path, setup, results } = file;
  if (setup.kind === 'disabled') logger.info(`${setup.reason}: nothing was sent`);
  else if (results.length > 0) logTarget(setup.config, setup.projectCode, logger);
  // Nothing else is written: PROBARA_RESULTS_FILE belongs to the reporters that fill the file.
  const env = Object.fromEntries(
    Object.entries(io.env).filter(([name]) => name !== 'PROBARA_RESULTS_FILE'),
  );
  const reporter = createReporter({
    ...file.options,
    ...runtimeOf(io, logger),
    env,
    ...(setup.kind === 'ready' ? { resultsFile: path, replaceResultsFile: true } : {}),
  });
  for (const result of results) reporter.addResult(result);
  const summary = await reporter.complete();
  if (setup.kind === 'ready' && summary.notSent === 0 && summary.resultsFile === undefined) {
    await deleteSent(path, io.cwd, logger);
  }
  const failures = reportingFailures(summary);
  if (failures.length > 0) {
    logRunLeftOpen(summary, setup.kind === 'ready' && 'ulid' in setup.config.run, logger);
  }
  return {
    sent: {
      path: file.shown,
      results: results.length,
      status: summary.status,
      tests: file.tests,
      summary,
    },
    failures,
  };
}

/** Logs what a file holds, before it is sent or shown. */
function logFile(file: LoadedFile, dryRun: boolean, logger: CommandContext['logger']): void {
  logger.debugEnabled = file.setup.kind === 'ready' ? file.setup.config.debug : logger.debugEnabled;
  // Core's reporter logs these warnings itself when it runs with reporting on.
  if (dryRun || file.setup.kind !== 'ready') {
    for (const warning of file.setup.warnings) logger.warn(warning);
  }
  logger.info(`${file.shown}: ${plural(file.results.length, 'result')}`);
  logger.info(`Results: ${file.results.length} ${describeTests(file.tests)}`);
  if (file.results.length === 0) {
    logger.warn(`${file.shown} holds no result: there is nothing to send`);
  }
}

/** Every file shown, as a real import would send it, and nothing sent. */
function printDryRuns(
  files: readonly LoadedFile[],
  json: boolean,
  { logger, output }: Pick<CommandContext, 'logger' | 'output'>,
): number {
  const runs: { file: LoadedFile; run: DryRun }[] = [];
  for (const file of files) {
    logFile(file, true, logger);
    // A dry run resolves with reporting forced on, so it is never disabled.
    if (file.setup.kind !== 'ready') continue;
    logTarget(file.setup.config, file.setup.projectCode, logger);
    const run = dryRunOf(
      file.setup.config,
      file.results,
      file.setup.projectCode !== undefined,
      logger,
    );
    if (!json) for (const line of run.lines) output.line(line);
    runs.push({ file, run });
  }
  const invalid = runs.reduce((sum, { run }) => sum + run.invalid, 0);
  const exitCode = invalid > 0 ? EXIT_REPORTING_FAILED : EXIT_OK;
  if (json) {
    output.json({
      dryRun: true,
      exitCode,
      files: runs.map(({ file, run }) => ({
        path: file.shown,
        results: file.results.length,
        tests: file.tests,
        invalid: run.invalid,
        entries: run.entries,
        filtered: run.filtered,
        dropped: run.dropped,
      })),
    });
  } else {
    const tests = countTests(files.flatMap((file) => file.results));
    output.line(
      dryRunTotal(
        runs.map(({ run }) => run),
        files.length,
        tests,
      ),
    );
  }
  return endDryRun(invalid, logger);
}

export async function importResults(
  { values, positionals }: ParsedCommandLine,
  { io, logger, output }: CommandContext,
  clientName: string,
): Promise<number> {
  if (positionals.length === 0) {
    throw new UsageError('Missing the results files (or globs) to import', HELP);
  }
  const dryRun = values.get('dry-run') === true;
  const json = values.get('json') === true;
  const flags = toCoreOptions('import results', values, io.cwd);
  logger.debugEnabled = values.get('debug') === true;
  if (
    values.get('source') === false &&
    ['branch', 'commit', 'build-url'].some((name) => values.has(name))
  ) {
    logger.warn('Ignored --branch, --commit and --build-url: --no-source sends no source');
  }
  /** The options of one file: the flags, then the variables, then the file. */
  const fileOptions = (file: ProbaraOptions): ProbaraOptions => ({
    rootDir: io.cwd,
    ...merge(fileSettingsUnder(file, io.env), flags),
    clientName,
    // A dry run shows what would be sent, whether or not reporting is turned on.
    ...(dryRun ? { enabled: true } : {}),
  });
  const setupOf = (options: ProbaraOptions) =>
    resolveSetup(options, io.env, { requireCredentials: !dryRun, now: io.now });

  const matched = await matchFiles(positionals, io.cwd, {
    directoryGlob: false,
    compare: bySiblingNumber,
  });
  const [directory] = matched.directories;
  if (directory !== undefined) {
    throw new UsageError(
      `${directory} is a directory: give the results files, or a glob such as 'probara-results*.json'`,
      HELP,
    );
  }
  if (matched.files.length === 0) {
    // No file is the usual outcome: the reporters sent everything. The command line is still
    // checked, so a wrong one fails now rather than the day a file shows up.
    const setup = resolveSetup(fileOptions({}), io.env, { requireCredentials: false, now: io.now });
    for (const warning of setup.warnings) logger.warn(warning);
    if (setup.kind === 'invalid') {
      for (const problem of setup.problems) logger.error(problem);
      logger.error('Nothing was sent.');
      return EXIT_USAGE;
    }
    logger.info(`No results file matched ${positionals.join(', ')}: nothing was left unsent`);
    if (json) output.json({ exitCode: EXIT_OK, files: [] });
    return EXIT_OK;
  }
  for (const pattern of matched.unmatched) logger.warn(`No file matched ${pattern}`);

  // Every file is read and checked before anything is sent: one that cannot be imported sends none.
  const named = new Set(positionals.map((pattern) => resolve(io.cwd, pattern)));
  const files: LoadedFile[] = [];
  const errors: string[] = [];
  let unusable = 0;
  for (const path of matched.files) {
    const shown = displayPath(path, io.cwd);
    // An empty file a glob matched holds nothing to send (a writer of an earlier version left it,
    // or still writes it): it never holds the others back. One named on its own is refused below.
    if (!named.has(path) && (await isEmpty(path))) {
      logger.warn(
        `Skipped ${shown}: the file is empty (a reporter may still be writing it, or stopped before it finished), so it holds no result to send`,
      );
      continue;
    }
    const reading = await readResultsFile(path);
    if (!reading.ok) {
      errors.push(reading.error.replace(path, shown));
      unusable += 1;
      continue;
    }
    const options = fileOptions(reading.options);
    const setup = setupOf(options);
    if (setup.kind === 'invalid') {
      for (const warning of setup.warnings) logger.warn(warning);
      errors.push(...setup.problems.map((problem) => `${shown}: ${problem}`));
      unusable += 1;
      continue;
    }
    const { results } = reading;
    files.push({ path, shown, results, tests: countTests(results), options, setup });
  }
  if (errors.length > 0) {
    for (const error of errors) logger.error(error);
    logger.error(
      `Nothing was sent: ${plural(unusable, 'file')} could not be imported. ${unusable === 1 ? 'Fix it or leave it out.' : 'Fix them or leave them out.'}`,
    );
    return EXIT_USAGE;
  }

  if (dryRun) return printDryRuns(files, json, { logger, output });

  const sent: SentFile[] = [];
  const failed: string[] = [];
  for (const file of files) {
    logFile(file, false, logger);
    const outcome = await sendFile(file, { io, logger });
    sent.push(outcome.sent);
    if (outcome.failures.length === 0) continue;
    const reasons = outcome.failures.join(', ');
    failed.push(files.length === 1 ? reasons : `${file.shown}: ${reasons}`);
  }
  const exitCode = failed.length > 0 ? EXIT_REPORTING_FAILED : EXIT_OK;
  if (failed.length > 0) {
    logger.error(`Exit 1: reporting to Probara failed (${failed.join('; ')})`);
  }
  if (json) output.json({ exitCode, files: sent });
  return exitCode;
}
