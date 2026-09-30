/** What both imports share: counting, the pre-flight target, the dry run and the exit reasons. */
import {
  applyStatusRules,
  parseCaseDisplayId,
  projectOfCase,
  toReportEntry,
  type ReportResultEntry,
  type ReportSummary,
  type ResolvedConfig,
  type ResultStatus,
  type TestResultInput,
} from '@probara/core';
import { resolve } from 'node:path';
import { EXIT_OK, EXIT_REPORTING_FAILED } from '../exit-codes.js';
import type { CliIO } from '../io.js';
import { stringOf, type OptionValue } from '../options.js';
import type { CommandContext } from './context.js';

export type Tests = Record<ResultStatus, number>;

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The results of each status; a result of an unknown status (a hand-edited file) counts in none. */
export function countTests(results: readonly TestResultInput[]): Tests {
  const tests: Tests = { passed: 0, failed: 0, skipped: 0, blocked: 0 };
  for (const result of results) {
    const status: unknown = (result as Partial<TestResultInput> | null)?.status;
    if (typeof status === 'string' && Object.hasOwn(tests, status)) {
      tests[status as ResultStatus] += 1;
    }
  }
  return tests;
}

/** `(7 passed, 2 failed, 1 skipped, 0 blocked)` */
export function describeTests(tests: Tests): string {
  return `(${tests.passed} passed, ${tests.failed} failed, ${tests.skipped} skipped, ${tests.blocked} blocked)`;
}

/** Exit 1 reasons: what failed at runtime, from core's summary. */
export function reportingFailures(summary: ReportSummary): string[] {
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

/**
 * After exit 1: the run that stays open, and how to send into it instead of creating a new one.
 * A reused run was already given, so a re-run sends into it anyway, every result again.
 */
export function logRunLeftOpen(
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

export function describeRun(run: ResolvedConfig['run']): string {
  return 'ulid' in run ? `${run.ulid} (existing run)` : `new run "${run.name}"`;
}

/** Where the results go: never the token. */
export function logTarget(
  config: ResolvedConfig,
  projectCode: string | undefined,
  logger: CommandContext['logger'],
): void {
  logger.info(`Project: ${projectCode ?? '(none: ids in test names are not linked)'}`);
  if (config.projects.length > 0) {
    logger.info(
      `Other projects: ${config.projects.map((project) => project.projectId).join(', ')}`,
    );
  }
  logger.info(`Run: ${describeRun(config.run)}`);
  for (const project of config.projects) {
    logger.info(`Run of ${project.projectId}: ${describeRun(project.run)}`);
  }
  logger.info(`Base URL: ${config.baseUrl}`);
  logger.info(`Missing cases: ${config.createMissingCases ? 'created' : 'not created'}`);
  logger.info(`Attachments: ${config.uploadAttachments ? 'on' : 'off'}`);
}

export function printDryRun(
  config: ResolvedConfig,
  results: readonly TestResultInput[],
  imported: {
    /** What the JSON document says of the input, after `exitCode`: `{ files }`, `{ file }`. */
    document: Record<string, unknown>;
    /** The files the results came from. */
    fileCount: number;
    tests: Tests;
    json: boolean;
    /** Whether the project is known, so entries of unlisted projects can be told apart. */
    routed: boolean;
  },
  { logger, output }: Pick<CommandContext, 'logger' | 'output'>,
): number {
  const entries: ReportResultEntry[] = [];
  /** Entries `--status-filter` leaves out: shown, never sent. */
  const filtered: ReportResultEntry[] = [];
  /** Entries linked to a case of a project that is not listed: shown, never sent. */
  const dropped: ReportResultEntry[] = [];
  const lines: string[] = [];
  let invalid = 0;
  for (const result of results) {
    try {
      const rules = applyStatusRules(result.status, config);
      const conversion = toReportEntry(
        { ...result, status: rules.status },
        { rootDir: config.rootDir },
      );
      const { entry } = conversion;
      const line = `${entry.status}\t${entry.caseDisplayId ?? '-'}\t${entry.automationKey ?? ''}`;
      if (rules.filtered) {
        filtered.push(entry);
        lines.push(`${line}\tfiltered: not sent`);
        continue;
      }
      if (imported.routed && projectOfCase(entry.caseDisplayId, config) === undefined) {
        const other = parseCaseDisplayId(entry.caseDisplayId ?? '')?.projectCode ?? '?';
        dropped.push(entry);
        lines.push(`${line}\tdropped: ${other} is not listed in --projects, not sent`);
        continue;
      }
      for (const warning of conversion.warnings) logger.warn(warning);
      entries.push(entry);
      lines.push(line);
    } catch (error) {
      // A real import counts it as invalid and exits 1: so does the dry run.
      invalid += 1;
      logger.warn(
        `Skipped an invalid result: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const exitCode = invalid > 0 ? EXIT_REPORTING_FAILED : EXIT_OK;
  const { fileCount, tests } = imported;
  if (imported.json) {
    output.json({
      dryRun: true,
      exitCode,
      ...imported.document,
      tests,
      invalid,
      entries,
      filtered,
      dropped,
    });
  } else {
    for (const line of lines) output.line(line);
    const left = [
      ...(filtered.length === 0 ? [] : [`; ${filtered.length} filtered out, not sent`]),
      ...(dropped.length === 0
        ? []
        : [`; ${dropped.length} dropped (a project not listed), not sent`]),
    ].join('');
    const total = entries.length + filtered.length + dropped.length;
    output.line(
      `Total: ${plural(total, 'result')} from ${plural(fileCount, 'file')} ${describeTests(tests)}${left}`,
    );
  }
  logger.info('Dry run: nothing was sent');
  if (invalid > 0) {
    logger.error(`Exit 1: ${plural(invalid, 'invalid result')} that a real import would not send`);
  }
  return exitCode;
}

/** The seams of `io` and the CLI logger, for a core call. */
export function runtimeOf(io: CliIO, logger: CommandContext['logger']) {
  return {
    logger,
    env: io.env,
    ...(io.fetch === undefined ? {} : { fetch: io.fetch }),
    ...(io.sleep === undefined ? {} : { sleep: io.sleep }),
    ...(io.now === undefined ? {} : { now: io.now }),
  };
}

/**
 * `resultsFile` from `--results-file`, else from `PROBARA_RESULTS_FILE`, relative to the current
 * directory of the command (core would resolve the variable against the process's).
 */
export function resultsFileOption(
  values: ReadonlyMap<string, OptionValue>,
  io: CliIO,
): { resultsFile?: string } {
  const path = stringOf(values, 'results-file')?.trim() || io.env.PROBARA_RESULTS_FILE?.trim();
  return path === undefined || path === '' ? {} : { resultsFile: resolve(io.cwd, path) };
}
