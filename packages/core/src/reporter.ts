/** The reporter session: buffers results and sends them as reports into one run. */
import type { ReportRequest, ReportResponse, ReportResultEntry, UnmatchedReason } from './api.js';
import { createIdempotencyKey, ProbaraApiError, type ProbaraClient } from './client.js';
import { resolveConfig, type ProbaraOptions, type ResolvedConfig } from './config.js';
import { createConsoleLogger, redact, type Logger } from './logger.js';
import { toReportEntry, type ReportEntryConversion, type TestResultInput } from './result.js';
import {
  clientOf,
  isOptionsObject,
  loggerOf,
  messageOf,
  OPTIONS_NOT_AN_OBJECT,
  runUrlOf,
  safeLogger,
  secretsOf,
  type RuntimeOptions,
} from './runtime.js';
import { toSingleLine, truncate } from './text.js';

/** Options of {@link createReporter}: {@link ProbaraOptions} plus seams for adapters and tests. */
export interface ReporterOptions extends ProbaraOptions, RuntimeOptions {}

/** A result that recorded nothing, with what identifies its test. */
export interface UnmatchedResult {
  reason: UnmatchedReason;
  automationKey?: string;
  caseDisplayId?: string;
  title?: string;
}

/** What a reporter session did. */
export interface ReportSummary {
  /**
   * - `disabled`: reporting is off or not configured; nothing was sent.
   * - `empty`: no result to send; nothing was sent.
   * - `completed`: every report was recorded.
   * - `partial`: some reports were recorded, then one failed and the rest was not sent.
   * - `failed`: nothing was recorded (a configuration problem or a failed first report).
   */
  status: 'disabled' | 'empty' | 'completed' | 'partial' | 'failed';
  /** The run the reports went into, once one answered. `url` is its page in Probara. */
  run?: { ulid: string; displayId: string; state: 'open' | 'closed'; url: string };
  /** Results recorded in the run. */
  recorded: number;
  /** Cases the reports created. */
  created: number;
  /** Results the server matched to no case. */
  unmatched: UnmatchedResult[];
  /** Results `addResult` could not convert (adapter bugs); never sent. */
  invalid: number;
  /** Results that did not reach Probara: those of the failed report and of every later one. */
  notSent: number;
  /** Configuration problems and failed reports. Messages never hold the token. */
  errors: { message: string; code?: string; status?: number }[];
}

/** A reporting session of one test run. */
export interface ProbaraReporter {
  /** Whether results will be sent: `false` when reporting is off, unconfigured or misconfigured. */
  readonly enabled: boolean;
  /** Queues one finished test. Never throws; an invalid result is counted and logged. */
  addResult(input: TestResultInput): void;
  /** Sends what is left and waits for every report. Never rejects; returns the same promise. */
  complete(): Promise<ReportSummary>;
}

type Label = Omit<UnmatchedResult, 'reason'>;

interface Pending {
  entry: ReportResultEntry;
  label: Label;
}

const MAX_EXAMPLES = 10;
const MAX_LOGGED_TITLE_LENGTH = 200;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The test's title path for a log line, or a placeholder when the input is too broken to tell. */
function describeInput(input: unknown): string {
  try {
    const { identity, title } = input as TestResultInput;
    const text = toSingleLine(
      typeof title === 'string' && title.trim() !== '' ? title : identity.titlePath.join(' > '),
    );
    return text === '' ? 'an untitled test' : `"${truncate(text, MAX_LOGGED_TITLE_LENGTH)}"`;
  } catch {
    return 'an unidentifiable test';
  }
}

function labelOf(entry: ReportResultEntry): Label {
  return {
    ...(entry.automationKey === undefined ? {} : { automationKey: entry.automationKey }),
    ...(entry.caseDisplayId === undefined ? {} : { caseDisplayId: entry.caseDisplayId }),
    ...(entry.title === undefined ? {} : { title: entry.title }),
  };
}

function emptySummary(status: ReportSummary['status']): ReportSummary {
  return { status, recorded: 0, created: 0, unmatched: [], invalid: 0, notSent: 0, errors: [] };
}

/** A reporter that sends nothing: reporting is off, or its configuration cannot be used. */
function inactiveReporter(summary: () => ReportSummary): ProbaraReporter {
  let completion: Promise<ReportSummary> | undefined;
  return {
    enabled: false,
    addResult() {},
    complete() {
      completion ??= Promise.resolve(summary());
      return completion;
    },
  };
}

/**
 * Creates a reporting session. The configuration is resolved once (options, then `PROBARA_*`
 * variables, then defaults); without a token and a project the reporter is disabled and quiet.
 *
 * Results are sent in reports of `chunkSize` (500) into one run, strictly in order: the first report
 * creates the run (or reuses `run.ulid`), later ones reuse it, and only the last one closes it (when
 * `closeRun`). After a report fails (the client already retried it), nothing more is sent and the
 * run is left open. Nothing here throws into the test framework.
 */
export function createReporter(options: ReporterOptions = {}): ProbaraReporter {
  if (!isOptionsObject(options)) {
    const logger = safeLogger(createConsoleLogger({ debug: false }), secretsOf({}, process.env));
    return failedReporter([OPTIONS_NOT_AN_OBJECT], logger);
  }
  try {
    return startReporter(options);
  } catch (error) {
    // A malformed option (an adapter bug) must not break the test run either.
    const secrets = secretsOf(options, options.env ?? process.env);
    const logger = safeLogger(options.logger ?? createConsoleLogger({ debug: false }), secrets);
    return failedReporter(
      [redact(`the reporter could not start: ${messageOf(error)}`, secrets)],
      logger,
    );
  }
}

/** A reporter that sends nothing because its configuration cannot be used; `problems` are logged. */
function failedReporter(problems: readonly string[], logger: Logger): ProbaraReporter {
  for (const problem of problems) logger.error(`Probara reporting is off: ${problem}`);
  let ignored = 0;
  const reporter = inactiveReporter(() => ({
    ...emptySummary('failed'),
    notSent: ignored,
    errors: problems.map((message) => ({ message })),
  }));
  return {
    ...reporter,
    addResult() {
      ignored += 1;
    },
  };
}

function startReporter(options: ReporterOptions): ProbaraReporter {
  const env = options.env ?? process.env;
  const now = options.now;
  const resolution = resolveConfig(options, env, now === undefined ? {} : { now });
  const logger = loggerOf(resolution, options, env);

  if (!resolution.ok && resolution.disabled) {
    logger.debug(resolution.reason);
    for (const warning of resolution.warnings) logger.debug(warning);
    return inactiveReporter(() => emptySummary('disabled'));
  }

  let problems: string[];
  let config: ResolvedConfig | undefined;
  let client: ProbaraClient | undefined;
  if (resolution.ok) {
    for (const warning of resolution.warnings) logger.warn(warning);
    config = resolution.config;
    try {
      client = clientOf(config, options, logger);
      problems = [];
    } catch (error) {
      problems = [redact(messageOf(error), [config.apiToken])];
    }
  } else {
    for (const warning of resolution.warnings) logger.warn(warning);
    problems = resolution.problems;
  }

  if (config === undefined || client === undefined) return failedReporter(problems, logger);

  return activeReporter(config, client, logger);
}

function activeReporter(
  config: ResolvedConfig,
  client: ProbaraClient,
  logger: Logger,
): ProbaraReporter {
  const clean = (text: string) => redact(text, [config.apiToken]);
  const summary = emptySummary('empty');
  const warned = new Set<string>();
  let buffer: Pending[] = [];
  let chain: Promise<void> = Promise.resolve();
  let run: ReportRequest['run'] = runInputOf(config);
  let reportsSent = 0;
  let reportsRecorded = 0;
  let failed = false;
  let completion: Promise<ReportSummary> | undefined;
  let warnedLate = false;

  function runInputOf(resolved: ResolvedConfig): ReportRequest['run'] {
    if ('ulid' in resolved.run) return { ulid: resolved.run.ulid };
    const { name, environmentId, milestoneId, configurationUlids, tags } = resolved.run;
    return {
      name,
      ...(environmentId === undefined ? {} : { environmentId }),
      ...(milestoneId === undefined ? {} : { milestoneId }),
      ...(configurationUlids.length === 0 ? {} : { configurationUlids: [...configurationUlids] }),
      ...(tags.length === 0 ? {} : { tags: [...tags] }),
    };
  }

  function withSource(input: ReportRequest['run']): ReportRequest['run'] {
    return Object.keys(config.source).length === 0
      ? input
      : { ...input, source: { ...config.source } };
  }

  function record(response: ReportResponse, batch: readonly Pending[]): void {
    summary.recorded += response.summary.recorded;
    summary.created += response.summary.created;
    response.results.forEach((outcome, index) => {
      if (outcome.outcome !== 'unmatched') return;
      const label = batch[index]?.label ?? {};
      summary.unmatched.push({ reason: outcome.reason, ...label });
    });
    const { ulid, displayId, state } = response.run;
    summary.run = { ulid, displayId, state, url: runUrlOf(config, displayId) };
    run = { ulid };
  }

  async function send(batch: readonly Pending[], last: boolean): Promise<void> {
    if (failed) {
      summary.notSent += batch.length;
      return;
    }
    reportsSent += 1;
    try {
      const body: ReportRequest = {
        run: withSource(run),
        results: batch.map((pending) => pending.entry),
        options: {
          createMissingCases: config.createMissingCases,
          ...(config.suiteUlid === undefined ? {} : { suiteUlid: config.suiteUlid }),
          close: last && config.closeRun,
        },
      };
      const response = await client.submitReport(config.projectId, body, {
        idempotencyKey: createIdempotencyKey(),
      });
      record(response, batch);
      reportsRecorded += 1;
    } catch (error) {
      failed = true;
      summary.notSent += batch.length;
      summary.errors.push({
        message: clean(messageOf(error)),
        ...(error instanceof ProbaraApiError ? { code: error.code, status: error.status } : {}),
      });
    }
  }

  function enqueue(batch: readonly Pending[], last: boolean): void {
    // `send` never rejects, so the chain never holds an unhandled rejection.
    chain = chain.then(() => send(batch, last));
  }

  function warnOnce(message: string, title: string): void {
    if (warned.has(message)) {
      logger.debug(`${message} (${title})`);
      return;
    }
    warned.add(message);
    logger.warn(`${message} (first seen in ${title}; repeats are logged at debug)`);
  }

  /** The entry of `input`, or `undefined` (counted and logged) when it cannot be converted. */
  function convert(input: TestResultInput): ReportEntryConversion | undefined {
    try {
      return toReportEntry(input, { rootDir: config.rootDir });
    } catch (error) {
      summary.invalid += 1;
      logger.warn(`Skipped the invalid result of ${describeInput(input)}: ${messageOf(error)}`);
      return undefined;
    }
  }

  function addResult(input: TestResultInput): void {
    try {
      if (completion !== undefined) {
        if (!warnedLate) logger.warn('Ignored results added after complete()');
        warnedLate = true;
        return;
      }
      const conversion = convert(input);
      if (conversion === undefined) return;
      for (const warning of conversion.warnings) warnOnce(warning, describeInput(input));
      buffer.push({ entry: conversion.entry, label: labelOf(conversion.entry) });
      if (buffer.length > config.chunkSize) enqueue(buffer.splice(0, config.chunkSize), false);
    } catch {
      // `addResult` never throws into the test framework.
    }
  }

  function logUnmatched(): void {
    const byReason = new Map<UnmatchedReason, UnmatchedResult[]>();
    for (const result of summary.unmatched) {
      byReason.set(result.reason, [...(byReason.get(result.reason) ?? []), result]);
    }
    for (const [reason, results] of byReason) {
      const examples = results
        .slice(0, MAX_EXAMPLES)
        .map((result) => result.caseDisplayId ?? result.automationKey ?? result.title ?? '?');
      const more =
        results.length > MAX_EXAMPLES ? `, and ${results.length - MAX_EXAMPLES} more` : '';
      logger.warn(
        `${plural(results.length, 'result was', 'results were')} not recorded (${reason}): ${examples.join('; ')}${more}`,
      );
    }
  }

  function logOutcome(): void {
    if (summary.run !== undefined) {
      const { displayId, state, url } = summary.run;
      logger.info(
        `Recorded ${plural(summary.recorded, 'result', 'results')} (${plural(summary.created, 'new case', 'new cases')}, ${summary.unmatched.length} unmatched) in ${displayId} (${state}): ${url}`,
      );
    }
    logUnmatched();
    if (summary.errors.length > 0) {
      const where =
        summary.run === undefined
          ? 'No run was created or updated'
          : `The run ${summary.run.displayId} was left open: ${summary.run.url}`;
      const reasons = summary.errors.map((error) => error.message).join('; ');
      logger.error(
        `${plural(summary.notSent, 'result was', 'results were')} not sent: ${reasons}. ${where}`,
      );
    }
  }

  async function finish(): Promise<ReportSummary> {
    try {
      if (buffer.length > 0) enqueue(buffer, true);
      buffer = [];
      await chain;
      if (reportsSent > 0) {
        summary.status =
          reportsRecorded === reportsSent
            ? 'completed'
            : reportsRecorded > 0
              ? 'partial'
              : 'failed';
      }
      summary.unmatched = summary.unmatched.map((result) => ({
        ...result,
        ...(result.automationKey === undefined
          ? {}
          : { automationKey: clean(result.automationKey) }),
        ...(result.title === undefined ? {} : { title: clean(result.title) }),
      }));
      logOutcome();
    } catch (error) {
      summary.status = reportsRecorded > 0 ? 'partial' : 'failed';
      summary.errors.push({ message: clean(messageOf(error)) });
    }
    return summary;
  }

  return {
    enabled: true,
    addResult,
    complete() {
      completion ??= finish();
      return completion;
    },
  };
}
