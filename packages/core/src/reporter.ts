/** The reporter session: buffers results and sends them as reports into one run. */
import type {
  CommitAttachmentItem,
  ReportRequest,
  ReportResponse,
  ReportResultEntry,
  StagedAttachment,
  UnmatchedReason,
} from './api.js';
import {
  groupStageRequests,
  loadAttachment,
  prepareAttachments,
  type AttachmentProblem,
  type PreparedAttachment,
} from './attachments.js';
import {
  createIdempotencyKey,
  ProbaraApiError,
  type AttachmentUpload,
  type ProbaraClient,
} from './client.js';
import { resolveConfig, type ProbaraOptions, type ResolvedConfig } from './config.js';
import { createConsoleLogger, redact, type Logger } from './logger.js';
import { MAX_ATTACHMENTS_PER_RESULT } from './limits.js';
import {
  fanOutByCase,
  toReportEntry,
  type ReportEntryConversion,
  type TestResultInput,
} from './result.js';
import {
  clientOf,
  isOptionsObject,
  loggerOf,
  messageOf,
  newRunFieldsOf,
  OPTIONS_NOT_AN_OBJECT,
  runUrlOf,
  safeLogger,
  secretsOf,
  sourceFieldOf,
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
  /**
   * The run the reports went into, once one answered. `url` is its page in Probara. `state` is the
   * last one known: a run found already closed or aborted by the deferred close keeps it.
   */
  run?: { ulid: string; displayId: string; state: 'open' | 'closed'; url: string };
  /** Results recorded in the run. */
  recorded: number;
  /** Cases the reports created. */
  created: number;
  /** Results the server matched to no case. */
  unmatched: UnmatchedResult[];
  /** Results `addResult` could not convert (adapter bugs); never sent. */
  invalid: number;
  /** Results left out by `statusFilter` (after `statusMapping`), one per case; never sent. */
  filtered: number;
  /** Results that did not reach Probara: those of the failed report and of every later one. */
  notSent: number;
  /**
   * Configuration problems, failed reports, and a failed close after the uploads. Messages never
   * hold the token.
   */
  errors: ReportError[];
  /**
   * Files of recorded results: `uploaded` (committed to their result), `skipped` (never sent: no
   * source, missing, empty, too large, refused type, an image Probara refuses, beyond 20 per
   * result, or a result that was not recorded) and `failed` (a stage or commit request failed).
   * They never change `status`.
   */
  attachments: { uploaded: number; skipped: number; failed: number };
  /** Failed stage and commit requests. Messages never hold the token. */
  attachmentErrors: ReportError[];
}

/** A failure in a {@link ReportSummary}. */
export interface ReportError {
  message: string;
  code?: string;
  status?: number;
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
  /** How the test is named in log lines. */
  description: string;
  attachments: readonly PreparedAttachment[];
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
  return {
    status,
    recorded: 0,
    created: 0,
    unmatched: [],
    invalid: 0,
    filtered: 0,
    notSent: 0,
    errors: [],
    attachments: { uploaded: 0, skipped: 0, failed: 0 },
    attachmentErrors: [],
  };
}

function errorOf(message: string, error: unknown): ReportError {
  return {
    message,
    ...(error instanceof ProbaraApiError ? { code: error.code, status: error.status } : {}),
  };
}

/** A run of async tasks, at most `concurrency` at a time, in the order they were added. */
function createLimiter(concurrency: number): (task: () => Promise<void>) => Promise<void> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return (task) =>
    new Promise<void>((resolve) => {
      const start = () => {
        active += 1;
        task()
          .catch(() => undefined)
          .finally(() => {
            active -= 1;
            waiting.shift()?.();
            resolve();
          });
      };
      if (active < concurrency) start();
      else waiting.push(start);
    });
}

/** Whether a stage request was refused for the content of one of its files (422). */
function isRefusedContent(error: unknown): boolean {
  return error instanceof ProbaraApiError && error.status === 422;
}

/** The fields of a staged ref a commit accepts, whatever else the server adds to it later. */
function commitItemOf(ref: StagedAttachment, position: number): CommitAttachmentItem {
  const {
    ulid,
    objectKey,
    mime,
    byteSize,
    originalFilename,
    disposition,
    thumbKey,
    width,
    height,
  } = ref;
  return {
    ulid,
    objectKey,
    mime,
    byteSize,
    originalFilename,
    disposition,
    thumbKey,
    width,
    height,
    position,
  };
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
 *
 * The attachments of each recorded result are uploaded after its report (stage, then commit),
 * `attachmentConcurrency` results at a time, without holding back the next report: while a report
 * is queued or in flight, no new upload request starts. Staging needs an open run, so once any
 * attachment was queued the last report leaves the run open, and the run is closed on its own after
 * every upload settled.
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
  /** Whether any result came with an attachment to upload: the run is then closed on its own. */
  let attachmentsQueued = false;
  const uploads: Promise<void>[] = [];
  const limit = createLimiter(config.attachmentConcurrency);
  /** Reports queued or in flight; uploads start no request meanwhile (they share the rate limit). */
  let reportsPending = 0;
  let reportsSettled: Promise<void> = Promise.resolve();
  let releaseUploads: () => void = () => undefined;

  function runInputOf(resolved: ResolvedConfig): ReportRequest['run'] {
    return 'ulid' in resolved.run ? { ulid: resolved.run.ulid } : newRunFieldsOf(resolved.run);
  }

  function withSource(input: ReportRequest['run']): ReportRequest['run'] {
    return { ...input, ...sourceFieldOf(config.source) };
  }

  function record(response: ReportResponse, batch: readonly Pending[]): void {
    summary.recorded += response.summary.recorded;
    summary.created += response.summary.created;
    const { ulid, displayId, state } = response.run;
    batch.forEach((pending, index) => {
      const outcome = response.results[index];
      if (outcome?.outcome === 'unmatched') {
        summary.unmatched.push({ reason: outcome.reason, ...pending.label });
      }
      if (pending.attachments.length === 0) return;
      if (outcome?.outcome === 'recorded') {
        const { resultUlid } = outcome;
        uploads.push(limit(() => uploadAttachments(ulid, resultUlid, pending)));
      } else {
        summary.attachments.skipped += pending.attachments.length;
      }
    });
    summary.run = { ulid, displayId, state, url: runUrlOf(config, displayId) };
    run = { ulid };
  }

  function skipAttachment(problem: AttachmentProblem, pending: Pending, name: string): void {
    summary.attachments.skipped += 1;
    const detail = problem.detail === undefined ? '' : `, ${problem.detail}`;
    warnOnce(
      `Skipped an attachment: ${problem.reason}`,
      `${pending.description}, ${name}${detail}`,
    );
  }

  function attachmentFailed(files: number, pending: Pending, error: unknown): void {
    summary.attachments.failed += files;
    const message = clean(messageOf(error));
    summary.attachmentErrors.push(errorOf(message, error));
    logger.warn(
      `Could not attach ${plural(files, 'file', 'files')} to the result of ${pending.description}: ${message}`,
    );
  }

  /** Stages the files of one recorded result, then commits them at positions 0..n-1. Never rejects. */
  async function uploadAttachments(
    runUlid: string,
    resultUlid: string,
    pending: Pending,
  ): Promise<void> {
    const loaded: AttachmentUpload[] = [];
    for (const attachment of pending.attachments) {
      const outcome = await loadAttachment(attachment);
      if ('upload' in outcome) loaded.push(outcome.upload);
      else skipAttachment(outcome.skipped, pending, attachment.name);
    }
    // The cap counts files that can be uploaded, so a skipped one displaces no later file.
    const overLimit = Math.max(0, loaded.length - MAX_ATTACHMENTS_PER_RESULT);
    if (overLimit > 0) {
      loaded.length = MAX_ATTACHMENTS_PER_RESULT;
      summary.attachments.skipped += overLimit;
      warnOnce(
        `Skipped the attachments beyond the first ${MAX_ATTACHMENTS_PER_RESULT} uploadable ones of a result`,
        `${pending.description}, ${overLimit} skipped`,
      );
    }
    const groups = groupStageRequests(loaded);
    const staged: StagedAttachment[] = [];
    while (groups.length > 0) {
      const group = groups.shift() ?? [];
      try {
        await yieldToReports();
        const response = await client.stageResultAttachments(runUlid, resultUlid, group);
        staged.push(...response.attachments);
      } catch (error) {
        if (isRefusedContent(error)) {
          if (group.length === 1) {
            attachmentFailed(1, pending, error);
          } else {
            // The first invalid part refuses the whole request: send each file on its own, in
            // order, so only the offending ones fail.
            logger.debug(
              `A stage request of ${plural(group.length, 'file', 'files')} for ${pending.description} was refused; retrying each file on its own`,
            );
            groups.unshift(...group.map((upload) => [upload]));
          }
          continue;
        }
        // The later requests would meet the same refusal (a closed run, a missing result...).
        const unsent = [group, ...groups].reduce((total, files) => total + files.length, 0);
        attachmentFailed(unsent, pending, error);
        break;
      }
    }
    if (staged.length === 0) return;
    try {
      await yieldToReports();
      // A fresh result has no attachment yet, so the staged refs are its whole list.
      await client.commitResultAttachments(
        runUlid,
        resultUlid,
        { attachments: staged.map(commitItemOf) },
        { idempotencyKey: createIdempotencyKey() },
      );
      summary.attachments.uploaded += staged.length;
    } catch (error) {
      attachmentFailed(staged.length, pending, error);
    }
  }

  function reportQueued(): void {
    if (reportsPending === 0) {
      reportsSettled = new Promise((resolve) => {
        releaseUploads = resolve;
      });
    }
    reportsPending += 1;
  }

  function reportSettled(): void {
    reportsPending -= 1;
    if (reportsPending === 0) releaseUploads();
  }

  /**
   * Resolves once no report is queued or in flight. Reports and uploads share the organization's
   * rate limit, and a report must not wait behind a burst of uploads, so every upload request waits
   * here first; requests already started are not interrupted.
   */
  async function yieldToReports(): Promise<void> {
    while (reportsPending > 0) await reportsSettled;
  }

  function skipAllAttachments(batch: readonly Pending[]): void {
    for (const pending of batch) summary.attachments.skipped += pending.attachments.length;
  }

  async function send(batch: readonly Pending[], last: boolean): Promise<void> {
    if (failed) {
      summary.notSent += batch.length;
      skipAllAttachments(batch);
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
          // With attachments, the run closes on its own once they are uploaded.
          close: last && config.closeRun && !attachmentsQueued,
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
      skipAllAttachments(batch);
      summary.errors.push(errorOf(clean(messageOf(error)), error));
    }
  }

  function enqueue(batch: readonly Pending[], last: boolean): void {
    reportQueued();
    // `send` never rejects, so the chain never holds an unhandled rejection.
    chain = chain.then(() => send(batch, last)).then(reportSettled);
  }

  function warnOnce(message: string, title: string): void {
    if (warned.has(message)) {
      logger.debug(`${message} (${title})`);
      return;
    }
    warned.add(message);
    logger.warn(`${message} (first seen in ${title}; repeats are logged at debug)`);
  }

  /**
   * The entries of `input`, one per linked case (see {@link fanOutByCase}), or `undefined` (counted
   * once and logged) when it cannot be converted: the copies differ only in the case, so one invalid
   * copy makes them all invalid.
   */
  function convert(
    input: TestResultInput,
  ): { copy: TestResultInput; conversion: ReportEntryConversion }[] | undefined {
    try {
      const status = config.statusMapping[input.status] ?? input.status;
      return fanOutByCase({ ...input, status }).map((copy) => ({
        copy,
        conversion: toReportEntry(copy, { rootDir: config.rootDir }),
      }));
    } catch (error) {
      summary.invalid += 1;
      logger.warn(`Skipped the invalid result of ${describeInput(input)}: ${messageOf(error)}`);
      return undefined;
    }
  }

  /** The attachments of `input` to upload; skipped ones are counted and logged. */
  function attachmentsOf(input: TestResultInput, description: string): PreparedAttachment[] {
    if (!config.uploadAttachments) return [];
    const { attachments, skipped } = prepareAttachments(input.attachments);
    for (const { reason, name } of skipped) {
      summary.attachments.skipped += 1;
      warnOnce(`Skipped an attachment: ${reason}`, `${description}, ${name}`);
    }
    if (attachments.length > 0) attachmentsQueued = true;
    return attachments;
  }

  function addResult(input: TestResultInput): void {
    try {
      if (completion !== undefined) {
        if (!warnedLate) logger.warn('Ignored results added after complete()');
        warnedLate = true;
        return;
      }
      const conversions = convert(input);
      if (conversions === undefined) return;
      const description = describeInput(input);
      for (const { copy, conversion } of conversions) {
        if (config.statusFilter.includes(conversion.entry.status)) {
          summary.filtered += 1;
          continue;
        }
        for (const warning of conversion.warnings) warnOnce(warning, description);
        buffer.push({
          entry: conversion.entry,
          label: labelOf(conversion.entry),
          description,
          attachments: attachmentsOf(copy, description),
        });
        if (buffer.length > config.chunkSize) enqueue(buffer.splice(0, config.chunkSize), false);
      }
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

  /** Closes the run once every upload settled; a run closed meanwhile is fine. */
  async function closeAfterUploads(): Promise<void> {
    const current = summary.run;
    if (current === undefined) return;
    try {
      const closed = await client.closeRun(current.ulid, {
        idempotencyKey: createIdempotencyKey(),
      });
      current.state = closed.state;
    } catch (error) {
      if (
        error instanceof ProbaraApiError &&
        error.status === 409 &&
        error.code === 'conflict' &&
        !error.retryable
      ) {
        // Closed or aborted meanwhile: Probara stores an aborted run as closed too.
        current.state = 'closed';
        logger.info(`The run ${current.displayId} was already closed or aborted`);
        return;
      }
      const message = clean(messageOf(error));
      summary.errors.push(errorOf(message, error));
      logger.error(
        `Could not close the run ${current.displayId}: ${message}. It was left open: ${current.url}`,
      );
    }
  }

  function logAttachments(): void {
    const { uploaded, skipped, failed: failedFiles } = summary.attachments;
    if (uploaded + skipped + failedFiles === 0) return;
    const line = `Attached ${plural(uploaded, 'file', 'files')} to results (${skipped} skipped, ${failedFiles} failed)`;
    if (failedFiles > 0) logger.warn(line);
    else logger.info(line);
  }

  function logOutcome(): void {
    if (summary.run !== undefined) {
      const { displayId, state, url } = summary.run;
      logger.info(
        `Recorded ${plural(summary.recorded, 'result', 'results')} (${plural(summary.created, 'new case', 'new cases')}, ${summary.unmatched.length} unmatched) in ${displayId} (${state}): ${url}`,
      );
    }
    if (summary.filtered > 0) {
      logger.info(
        `Filtered out ${plural(summary.filtered, 'result', 'results')} by their status (statusFilter): not sent`,
      );
    }
    logUnmatched();
    logAttachments();
    if (failed) {
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
      // Uploads are only added while reports are recorded, so the list is complete now.
      await Promise.all(uploads);
      if (attachmentsQueued && config.closeRun && !failed && reportsRecorded > 0) {
        await closeAfterUploads();
      }
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
