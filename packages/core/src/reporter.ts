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
import { parseCaseDisplayId } from './case-ids.js';
import { resolve } from 'node:path';
import {
  applyStatusRules,
  resolveConfig,
  type ProbaraOptions,
  type ResolvedConfig,
  type ResolvedRun,
} from './config.js';
import { createConsoleLogger, redact, type Logger } from './logger.js';
import {
  MAX_ATTACHMENTS_PER_RESULT,
  MAX_CASE_STEPS_PER_REPORT,
  MAX_CASE_TAGS_PER_REPORT,
  MAX_RESULT_STEPS_PER_REPORT,
} from './limits.js';
import {
  entryTotals,
  fanOutByCase,
  toReportEntry,
  type EntryTotals,
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
import { headerOf, writeResultsFile, type ResultsFileHeader } from './results-file.js';
import { toSingleLine, truncate } from './text.js';

/** Options of {@link createReporter}: {@link ProbaraOptions} plus seams for adapters and tests. */
export interface ReporterOptions extends ProbaraOptions, RuntimeOptions {
  /**
   * Problems of the adapter's own settings (see `resolveBooleanSetting`). Each one turns reporting
   * off like a problem of core's own, after them; a disabled or unconfigured reporter stays quiet.
   */
  adapterProblems?: readonly string[] | undefined;
}

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
  /**
   * Results linked to a case of a project that is neither `projectId` nor one of `projects`, one
   * per case; never sent (they would land in the wrong project).
   */
  dropped: number;
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
  /**
   * What Probara skipped without failing a report, such as a case field it could not resolve
   * (`Unknown field "Sevrity" was skipped`): the `warnings` of every report, once each, prefixed
   * with the project when results may go to several. Each is logged once, as it arrives.
   */
  warnings: string[];
  /**
   * Every project results were sent to, the configured one first, then those of `projects` in
   * their order: its run and its counts. The fields above add them up (`run` is the configured
   * project's).
   */
  projects: ProjectReportSummary[];
  /**
   * The results file (`resultsFile`), when results were written to it: those that were not sent,
   * or every result when reporting is off. `error` says why it could not be written (`results` is
   * then 0).
   */
  resultsFile?: { path: string; results: number; error?: string };
}

/** What a session did in one project (see {@link ReportSummary.projects}). */
export interface ProjectReportSummary {
  projectId: string;
  /** `completed`: every report was recorded; `partial`: a later one failed; `failed`: none was. */
  status: 'completed' | 'partial' | 'failed';
  /** The run of the project, once a report was recorded; `url` is its page in Probara. */
  run?: { ulid: string; displayId: string; state: 'open' | 'closed'; url: string };
  recorded: number;
  created: number;
  /** Results the server matched to no case; the summary's `unmatched` lists them. */
  unmatched: number;
  notSent: number;
  /** Failed reports and a failed close in this project. */
  errors: ReportError[];
  attachments: { uploaded: number; skipped: number; failed: number };
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
  /**
   * Whether `addResult` does anything with a result: it is sent (`enabled`), or written to the
   * results file (`resultsFile`) while reporting is off or cannot be used.
   */
  readonly acceptsResults: boolean;
  /** Queues one finished test. Never throws; an invalid result is counted and logged. */
  addResult(input: TestResultInput): void;
  /** Sends what is left and waits for every report. Never rejects; returns the same promise. */
  complete(): Promise<ReportSummary>;
}

type Label = Omit<UnmatchedResult, 'reason'>;

interface Pending {
  entry: ReportResultEntry;
  /** What the entry adds to the per-report totals. */
  totals: EntryTotals;
  label: Label;
  /** How the test is named in log lines. */
  description: string;
  attachments: readonly PreparedAttachment[];
  /** The result of this case as the adapter gave it (its own status): what a results file keeps. */
  input: TestResultInput;
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
    dropped: 0,
    notSent: 0,
    errors: [],
    attachments: { uploaded: 0, skipped: 0, failed: 0 },
    attachmentErrors: [],
    warnings: [],
    projects: [],
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

/** Where a reporter that sends nothing writes every result: the results file and its settings. */
interface ResultsSink {
  path: string;
  header: () => ResultsFileHeader;
  secrets: readonly string[];
  logger: Logger;
}

/** Writes `results` to the results file; logs and returns what happened, never throws. */
async function writeResults(
  sink: ResultsSink,
  results: readonly TestResultInput[],
  line: (count: number) => string,
  level: 'info' | 'warn',
): Promise<NonNullable<ReportSummary['resultsFile']>> {
  const { path, logger } = sink;
  try {
    await writeResultsFile(path, sink.header(), results, sink.secrets);
    logger[level](`${line(results.length)} ${path}: send them with probara import results ${path}`);
    return { path, results: results.length };
  } catch (error) {
    const message = redact(messageOf(error), sink.secrets);
    logger.error(`Could not write the results file ${path}: ${message}`);
    return { path, results: 0, error: message };
  }
}

/**
 * A reporter that sends nothing: reporting is off, or its configuration cannot be used. With a
 * results file, it keeps every result and writes them all at the end.
 */
function inactiveReporter(summary: () => ReportSummary, sink?: ResultsSink): ProbaraReporter {
  let completion: Promise<ReportSummary> | undefined;
  const kept: TestResultInput[] = [];
  const finish = async (): Promise<ReportSummary> => {
    const done = summary();
    if (sink === undefined || kept.length === 0) return done;
    done.resultsFile = await writeResults(
      sink,
      kept,
      (count) => `Wrote ${plural(count, 'result', 'results')} to`,
      'info',
    );
    return done;
  };
  return {
    enabled: false,
    acceptsResults: sink !== undefined,
    addResult(input) {
      if (sink === undefined || completion !== undefined) return;
      if (typeof input === 'object' && (input as unknown) !== null) kept.push({ ...input });
    },
    complete() {
      completion ??= finish();
      return completion;
    },
  };
}

/** The absolute path of `resultsFile`, else of `PROBARA_RESULTS_FILE`, when either is set. */
function resultsFileOf(
  options: ReporterOptions,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const option: unknown = options.resultsFile;
  const path =
    typeof option === 'string' && option.trim() !== ''
      ? option.trim()
      : option === undefined
        ? env.PROBARA_RESULTS_FILE?.trim()
        : undefined;
  return path === undefined || path === '' ? undefined : resolve(path);
}

/** Stands in for the token and a missing project while settings are read for a results file. */
const PLACEHOLDER = 'PROBARA-RESULTS-FILE-PLACEHOLDER';

/**
 * The settings of a results file written while reporting is off or unusable: those of the
 * options, read as if reporting were on (never with the token), else only the project.
 */
function fallbackHeader(options: ReporterOptions): ResultsFileHeader {
  const env = options.env ?? process.env;
  const project =
    typeof options.projectId === 'string' && options.projectId.trim() !== ''
      ? options.projectId.trim()
      : env.PROBARA_PROJECT?.trim() || undefined;
  try {
    const probe = resolveConfig(
      { ...options, enabled: true, apiToken: PLACEHOLDER, projectId: project ?? PLACEHOLDER },
      env,
      options.now === undefined ? {} : { now: options.now },
    );
    if (probe.ok) {
      const header = headerOf(probe.config);
      if (project === undefined) delete header.project;
      return header;
    }
  } catch {
    // Malformed options: only the project is known.
  }
  return { version: 1, ...(project === undefined ? {} : { project }) };
}

/** The results file of a reporter that sends nothing, when one is set. */
function sinkOf(options: ReporterOptions, logger: Logger): ResultsSink | undefined {
  const env = options.env ?? process.env;
  const path = resultsFileOf(options, env);
  if (path === undefined) return undefined;
  return { path, header: () => fallbackHeader(options), secrets: secretsOf(options, env), logger };
}

/**
 * Creates a reporting session. The configuration is resolved once (options, then `PROBARA_*`
 * variables, then defaults); without a token and a project the reporter is disabled and quiet.
 *
 * Results are sent in reports of `chunkSize` (500) into one run, strictly in order: the first report
 * creates the run (or reuses `run.ulid`), later ones reuse it, and only the last one closes it (when
 * `closeRun`). A report is sent sooner when the next result would take it over a per-report total of
 * the server (10000 result steps, 10000 case steps or 1000 case tags). After a report fails (the client already retried it), nothing more is sent and the
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
      sinkOf(options, logger),
    );
  }
}

/** A reporter that sends nothing because its configuration cannot be used; `problems` are logged. */
function failedReporter(
  problems: readonly string[],
  logger: Logger,
  sink?: ResultsSink,
): ProbaraReporter {
  for (const problem of problems) logger.error(`Probara reporting is off: ${problem}`);
  let ignored = 0;
  const reporter = inactiveReporter(
    () => ({
      ...emptySummary('failed'),
      notSent: ignored,
      errors: problems.map((message) => ({ message })),
    }),
    sink,
  );
  return {
    ...reporter,
    addResult(input) {
      ignored += 1;
      reporter.addResult(input);
    },
  };
}

/** The problems an adapter passed, ignoring what is not a string (untyped adapters). */
function adapterProblemsOf(options: ReporterOptions): string[] {
  const problems: unknown = options.adapterProblems;
  return Array.isArray(problems)
    ? problems.filter((problem): problem is string => typeof problem === 'string')
    : [];
}

function startReporter(options: ReporterOptions): ProbaraReporter {
  const env = options.env ?? process.env;
  const now = options.now;
  const resolution = resolveConfig(options, env, now === undefined ? {} : { now });
  const logger = loggerOf(resolution, options, env);

  if (!resolution.ok && resolution.disabled) {
    logger.debug(resolution.reason);
    for (const warning of resolution.warnings) logger.debug(warning);
    return inactiveReporter(() => emptySummary('disabled'), sinkOf(options, logger));
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
  const secrets = secretsOf(options, env);
  problems.push(...adapterProblemsOf(options).map((problem) => redact(problem, secrets)));

  if (config === undefined || client === undefined || problems.length > 0) {
    return failedReporter(problems, logger, sinkOf(options, logger));
  }

  return activeReporter(config, client, logger);
}

/**
 * The project a result linked to `caseDisplayId` goes to: the project of its case (`WEB-3` is
 * `WEB`) when that is the configured project or one of `projects`, else `undefined` (the result
 * is dropped). Without a case, or with a malformed id, it is the configured project, whose server
 * says why it refuses the id. For an adapter that prints what is sent.
 */
export function projectOfCase(
  caseDisplayId: string | undefined,
  config: Pick<ResolvedConfig, 'projectId' | 'projects'>,
): string | undefined {
  const code =
    caseDisplayId === undefined ? undefined : parseCaseDisplayId(caseDisplayId.trim())?.projectCode;
  if (code === undefined || code === config.projectId) return config.projectId;
  return config.projects.some((project) => project.projectId === code) ? code : undefined;
}

/** The reports of one project: its run, its buffer and what it did. */
interface Session {
  readonly projectId: string;
  readonly closeRun: boolean;
  readonly createMissingCases: boolean;
  readonly suiteUlid: string | undefined;
  run: ReportRequest['run'];
  buffer: Pending[];
  /** What the entries of `buffer` add up to toward the per-report totals. */
  bufferTotals: EntryTotals;
  reportsSent: number;
  reportsRecorded: number;
  /** After a failed report, nothing more is sent to this project. */
  failed: boolean;
  /** Whether any result came with an attachment to upload: the run is then closed on its own. */
  attachmentsQueued: boolean;
  readonly summary: ProjectReportSummary;
}

type AttachmentCount = keyof ReportSummary['attachments'];

function noTotals(): EntryTotals {
  return { resultSteps: 0, caseSteps: 0, caseTags: 0 };
}

/** Adds `added` to `totals`, and returns `totals`. */
function addTotals(totals: EntryTotals, added: EntryTotals): EntryTotals {
  totals.resultSteps += added.resultSteps;
  totals.caseSteps += added.caseSteps;
  totals.caseTags += added.caseTags;
  return totals;
}

/** Whether `added` would take `totals` over a per-report total of the server. */
function exceedsTotals(totals: EntryTotals, added: EntryTotals): boolean {
  return (
    totals.resultSteps + added.resultSteps > MAX_RESULT_STEPS_PER_REPORT ||
    totals.caseSteps + added.caseSteps > MAX_CASE_STEPS_PER_REPORT ||
    totals.caseTags + added.caseTags > MAX_CASE_TAGS_PER_REPORT
  );
}

function runInputOf(run: ResolvedRun): ReportRequest['run'] {
  return 'ulid' in run ? { ulid: run.ulid } : newRunFieldsOf(run);
}

function activeReporter(
  config: ResolvedConfig,
  client: ProbaraClient,
  logger: Logger,
): ProbaraReporter {
  const clean = (text: string) => redact(text, [config.apiToken]);
  const summary = emptySummary('empty');
  const warned = new Set<string>();
  /** Whether results may go to other projects: log lines and errors then name the project. */
  const multi = config.projects.length > 0;
  const sessions = new Map<string, Session>();
  let chain: Promise<void> = Promise.resolve();
  let completion: Promise<ReportSummary> | undefined;
  let warnedLate = false;
  const uploads: Promise<void>[] = [];
  const limit = createLimiter(config.attachmentConcurrency);
  /** Reports queued or in flight; uploads start no request meanwhile (they share the rate limit). */
  let reportsPending = 0;
  let reportsSettled: Promise<void> = Promise.resolve();
  let releaseUploads: () => void = () => undefined;
  /** The results of every report that was not sent, in order: what a results file keeps. */
  const unsent: TestResultInput[] = [];

  function withSource(input: ReportRequest['run']): ReportRequest['run'] {
    return { ...input, ...sourceFieldOf(config.source) };
  }

  function newSession(
    projectId: string,
    run: ResolvedRun,
    settings: Pick<Session, 'closeRun' | 'createMissingCases' | 'suiteUlid'>,
  ): Session {
    const session: Session = {
      projectId,
      ...settings,
      run: runInputOf(run),
      buffer: [],
      bufferTotals: noTotals(),
      reportsSent: 0,
      reportsRecorded: 0,
      failed: false,
      attachmentsQueued: false,
      summary: {
        projectId,
        status: 'completed',
        recorded: 0,
        created: 0,
        unmatched: 0,
        notSent: 0,
        errors: [],
        attachments: { uploaded: 0, skipped: 0, failed: 0 },
      },
    };
    sessions.set(projectId, session);
    return session;
  }

  /**
   * The session of a project, started with its first result: the configured project, or one of
   * `projects`. Other projects have none: their results are dropped. Only the configured project
   * creates cases, and its suite belongs to it alone.
   */
  function sessionOf(projectId: string): Session | undefined {
    const existing = sessions.get(projectId);
    if (existing !== undefined) return existing;
    if (projectId === config.projectId) {
      return newSession(projectId, config.run, {
        closeRun: config.closeRun,
        createMissingCases: config.createMissingCases,
        suiteUlid: config.suiteUlid,
      });
    }
    const project = config.projects.find((candidate) => candidate.projectId === projectId);
    if (project === undefined) return undefined;
    return newSession(projectId, project.run, {
      closeRun: project.closeRun,
      createMissingCases: false,
      suiteUlid: undefined,
    });
  }

  /** The sessions in summary order: the configured project, then `projects` in their order. */
  function orderedSessions(): Session[] {
    return [config.projectId, ...config.projects.map((project) => project.projectId)]
      .map((projectId) => sessions.get(projectId))
      .filter((session): session is Session => session !== undefined);
  }

  function countAttachments(session: Session, field: AttachmentCount, files: number): void {
    summary.attachments[field] += files;
    session.summary.attachments[field] += files;
  }

  function addError(session: Session, error: ReportError): void {
    session.summary.errors.push(error);
    summary.errors.push(
      multi ? { ...error, message: `${session.projectId}: ${error.message}` } : error,
    );
  }

  function record(session: Session, response: ReportResponse, batch: readonly Pending[]): void {
    summary.recorded += response.summary.recorded;
    summary.created += response.summary.created;
    session.summary.recorded += response.summary.recorded;
    session.summary.created += response.summary.created;
    const warnings: unknown = response.warnings;
    for (const warning of Array.isArray(warnings) ? warnings : []) {
      if (typeof warning !== 'string') continue;
      const text = clean(multi ? `${session.projectId}: ${warning}` : warning);
      if (summary.warnings.includes(text)) continue;
      summary.warnings.push(text);
      logger.warn(`Probara warned: ${text}`);
    }
    const { ulid, displayId, state } = response.run;
    batch.forEach((pending, index) => {
      const outcome = response.results[index];
      if (outcome?.outcome === 'unmatched') {
        summary.unmatched.push({ reason: outcome.reason, ...pending.label });
        session.summary.unmatched += 1;
      }
      if (pending.attachments.length === 0) return;
      if (outcome?.outcome === 'recorded') {
        const { resultUlid } = outcome;
        uploads.push(limit(() => uploadAttachments(session, ulid, resultUlid, pending)));
      } else {
        countAttachments(session, 'skipped', pending.attachments.length);
      }
    });
    const run = { ulid, displayId, state, url: runUrlOf(config, displayId, session.projectId) };
    session.summary.run = run;
    // The same object: a deferred close updates both.
    if (session.projectId === config.projectId) summary.run = run;
    session.run = { ulid };
  }

  function skipAttachment(
    session: Session,
    problem: AttachmentProblem,
    pending: Pending,
    name: string,
  ): void {
    countAttachments(session, 'skipped', 1);
    const detail = problem.detail === undefined ? '' : `, ${problem.detail}`;
    warnOnce(
      `Skipped an attachment: ${problem.reason}`,
      `${pending.description}, ${name}${detail}`,
    );
  }

  function attachmentFailed(
    session: Session,
    files: number,
    pending: Pending,
    error: unknown,
  ): void {
    countAttachments(session, 'failed', files);
    const message = clean(messageOf(error));
    summary.attachmentErrors.push(errorOf(message, error));
    logger.warn(
      `Could not attach ${plural(files, 'file', 'files')} to the result of ${pending.description}: ${message}`,
    );
  }

  /** Stages the files of one recorded result, then commits them at positions 0..n-1. Never rejects. */
  async function uploadAttachments(
    session: Session,
    runUlid: string,
    resultUlid: string,
    pending: Pending,
  ): Promise<void> {
    const loaded: AttachmentUpload[] = [];
    for (const attachment of pending.attachments) {
      const outcome = await loadAttachment(attachment);
      if ('upload' in outcome) loaded.push(outcome.upload);
      else skipAttachment(session, outcome.skipped, pending, attachment.name);
    }
    // The cap counts files that can be uploaded, so a skipped one displaces no later file.
    const overLimit = Math.max(0, loaded.length - MAX_ATTACHMENTS_PER_RESULT);
    if (overLimit > 0) {
      loaded.length = MAX_ATTACHMENTS_PER_RESULT;
      countAttachments(session, 'skipped', overLimit);
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
            attachmentFailed(session, 1, pending, error);
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
        attachmentFailed(session, unsent, pending, error);
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
      countAttachments(session, 'uploaded', staged.length);
    } catch (error) {
      attachmentFailed(session, staged.length, pending, error);
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

  function notSent(session: Session, batch: readonly Pending[]): void {
    summary.notSent += batch.length;
    session.summary.notSent += batch.length;
    for (const pending of batch) {
      countAttachments(session, 'skipped', pending.attachments.length);
      unsent.push(pending.input);
    }
  }

  async function send(session: Session, batch: readonly Pending[], last: boolean): Promise<void> {
    if (session.failed) {
      notSent(session, batch);
      return;
    }
    session.reportsSent += 1;
    try {
      const body: ReportRequest = {
        run: withSource(session.run),
        results: batch.map((pending) => pending.entry),
        options: {
          createMissingCases: session.createMissingCases,
          ...(session.suiteUlid === undefined ? {} : { suiteUlid: session.suiteUlid }),
          // With attachments, the run closes on its own once they are uploaded.
          close: last && session.closeRun && !session.attachmentsQueued,
        },
      };
      const response = await client.submitReport(session.projectId, body, {
        idempotencyKey: createIdempotencyKey(),
      });
      record(session, response, batch);
      session.reportsRecorded += 1;
    } catch (error) {
      session.failed = true;
      notSent(session, batch);
      addError(session, errorOf(clean(messageOf(error)), error));
    }
  }

  function enqueue(session: Session, batch: readonly Pending[], last: boolean): void {
    reportQueued();
    // `send` never rejects, so the chain never holds an unhandled rejection.
    chain = chain.then(() => send(session, batch, last)).then(reportSettled);
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
  function convert(input: TestResultInput):
    | {
        copy: TestResultInput;
        original: TestResultInput;
        conversion: ReportEntryConversion;
        filtered: boolean;
      }[]
    | undefined {
    try {
      const { status, filtered } = applyStatusRules(input.status, config);
      const warnings: string[] = [];
      return fanOutByCase({ ...input, status }, warnings).map((copy) => {
        const conversion = toReportEntry(copy, { rootDir: config.rootDir });
        conversion.warnings.unshift(...warnings);
        return { copy, original: { ...copy, status: input.status }, conversion, filtered };
      });
    } catch (error) {
      summary.invalid += 1;
      logger.warn(`Skipped the invalid result of ${describeInput(input)}: ${messageOf(error)}`);
      return undefined;
    }
  }

  /** The attachments of `input` to upload; skipped ones are counted and logged. */
  function attachmentsOf(
    session: Session,
    input: TestResultInput,
    description: string,
  ): PreparedAttachment[] {
    if (!config.uploadAttachments) return [];
    const { attachments, skipped } = prepareAttachments(input.attachments);
    for (const { reason, name } of skipped) {
      countAttachments(session, 'skipped', 1);
      warnOnce(`Skipped an attachment: ${reason}`, `${description}, ${name}`);
    }
    if (attachments.length > 0) session.attachmentsQueued = true;
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
      for (const { copy, original, conversion, filtered } of conversions) {
        if (filtered) {
          summary.filtered += 1;
          continue;
        }
        const { caseDisplayId } = conversion.entry;
        const projectId = projectOfCase(caseDisplayId, config);
        const session = projectId === undefined ? undefined : sessionOf(projectId);
        if (session === undefined) {
          const other = parseCaseDisplayId(caseDisplayId ?? '')?.projectCode ?? '?';
          summary.dropped += 1;
          warnOnce(
            `Did not send the results linked to cases of ${other}: ${other} is neither the project (${config.projectId}) nor one of projects (PROBARA_PROJECTS)`,
            description,
          );
          continue;
        }
        for (const warning of conversion.warnings) warnOnce(warning, description);
        const totals = entryTotals(conversion.entry);
        // One entry never exceeds a total alone: its own limits are far below them.
        if (session.buffer.length > 0 && exceedsTotals(session.bufferTotals, totals)) {
          enqueue(session, session.buffer.splice(0), false);
          session.bufferTotals = noTotals();
        }
        session.buffer.push({
          entry: conversion.entry,
          totals,
          label: labelOf(conversion.entry),
          description,
          attachments: attachmentsOf(session, copy, description),
          input: original,
        });
        addTotals(session.bufferTotals, totals);
        if (session.buffer.length > config.chunkSize) {
          enqueue(session, session.buffer.splice(0, config.chunkSize), false);
          session.bufferTotals = session.buffer.reduce(
            (sum, pending) => addTotals(sum, pending.totals),
            noTotals(),
          );
        }
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

  /** Closes the run of `session` once every upload settled; a run closed meanwhile is fine. */
  async function closeAfterUploads(session: Session): Promise<void> {
    const current = session.summary.run;
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
      addError(session, errorOf(message, error));
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

  function logOutcome(ordered: readonly Session[]): void {
    for (const { projectId, summary: done } of ordered) {
      if (done.run === undefined) continue;
      const { displayId, state, url } = done.run;
      const where = multi ? `${displayId} of ${projectId}` : displayId;
      logger.info(
        `Recorded ${plural(done.recorded, 'result', 'results')} (${plural(done.created, 'new case', 'new cases')}, ${done.unmatched} unmatched) in ${where} (${state}): ${url}`,
      );
    }
    if (summary.filtered > 0) {
      logger.info(
        `Filtered out ${plural(summary.filtered, 'result', 'results')} by their status (statusFilter): not sent`,
      );
    }
    logUnmatched();
    logAttachments();
    for (const session of ordered) {
      if (!session.failed) continue;
      const { run, notSent: count, errors } = session.summary;
      const where =
        run === undefined
          ? 'No run was created or updated'
          : `The run ${run.displayId} was left open: ${run.url}`;
      const reasons = errors.map((error) => error.message).join('; ');
      const to = multi ? ` to ${session.projectId}` : '';
      logger.error(
        `${plural(count, 'result was', 'results were')} not sent${to}: ${reasons}. ${where}`,
      );
    }
  }

  /** Writes the results that were not sent to the results file, when one is set. */
  async function writeUnsent(ordered: readonly Session[]): Promise<void> {
    const path = config.resultsFile;
    if (path === undefined || unsent.length === 0) return;
    // The runs that exist now: the results go back into them.
    const runs = new Map<string, string>();
    for (const session of ordered) {
      if (session.summary.run !== undefined) runs.set(session.projectId, session.summary.run.ulid);
    }
    summary.resultsFile = await writeResults(
      { path, header: () => headerOf(config, runs), secrets: [config.apiToken], logger },
      unsent,
      (count) => `Wrote the ${plural(count, 'result that was', 'results that were')} not sent to`,
      'warn',
    );
  }

  async function finish(): Promise<ReportSummary> {
    const ordered = orderedSessions();
    try {
      for (const session of ordered) {
        if (session.buffer.length > 0) enqueue(session, session.buffer, true);
        session.buffer = [];
        session.bufferTotals = noTotals();
      }
      await chain;
      // Uploads are only added while reports are recorded, so the list is complete now.
      await Promise.all(uploads);
      for (const session of ordered) {
        const { attachmentsQueued, closeRun, failed, reportsRecorded } = session;
        if (attachmentsQueued && closeRun && !failed && reportsRecorded > 0) {
          await closeAfterUploads(session);
        }
      }
      for (const session of ordered) {
        session.summary.status =
          session.reportsRecorded === session.reportsSent
            ? 'completed'
            : session.reportsRecorded > 0
              ? 'partial'
              : 'failed';
      }
      const sent = ordered.reduce((total, session) => total + session.reportsSent, 0);
      const recorded = ordered.reduce((total, session) => total + session.reportsRecorded, 0);
      if (sent > 0) {
        summary.status = recorded === sent ? 'completed' : recorded > 0 ? 'partial' : 'failed';
      }
      summary.unmatched = summary.unmatched.map((result) => ({
        ...result,
        ...(result.automationKey === undefined
          ? {}
          : { automationKey: clean(result.automationKey) }),
        ...(result.title === undefined ? {} : { title: clean(result.title) }),
      }));
      summary.projects = ordered.map((session) => session.summary);
      logOutcome(ordered);
      await writeUnsent(ordered);
    } catch (error) {
      const recorded = ordered.some((session) => session.reportsRecorded > 0);
      summary.status = recorded ? 'partial' : 'failed';
      summary.errors.push({ message: clean(messageOf(error)) });
    }
    return summary;
  }

  return {
    enabled: true,
    acceptsResults: true,
    addResult,
    complete() {
      completion ??= finish();
      return completion;
    },
  };
}
