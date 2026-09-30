/**
 * What every test framework adapter does around `createReporter`: resolving its setup, counting
 * what it hands to core for its `Sending N results` line, warning once per problem, and logging its
 * own errors without the token.
 */
import type { ResultStatus } from './api.js';
import { parseCaseDisplayId } from './case-ids.js';
import {
  applyStatusRules,
  resolveBooleanSetting,
  resolveConfig,
  type ConfigResolution,
  type ProbaraOptions,
  type StatusRules,
} from './config.js';
import { createConsoleLogger, redact, type Logger } from './logger.js';
import type { TestResultInput } from './result.js';
import type { ReporterOptions } from './reporter.js';
import { isOptionsObject, secretsOf, type RuntimeOptions } from './runtime.js';

type Env = NonNullable<RuntimeOptions['env']>;

/** What {@link resolveAdapterSetup} needs from the adapter besides the user's options. */
export interface AdapterSetupContext {
  /** The directory test files are relative to when the options set no `rootDir`: the framework's. */
  rootDir: string;
  /** The adapter and its version, sent in the User-Agent (`probara-jest-reporter/0.1.0`). */
  clientName: string;
  /** Problems of the adapter's own settings: they turn reporting off like core's. */
  adapterProblems?: readonly string[] | undefined;
}

/** What an adapter needs once its framework began the run. */
export interface AdapterSetup {
  /** The options of `createReporter`. */
  core: ReporterOptions;
  /**
   * The project codes whose case ids are read from titles: the configured project, then those of
   * `projects`. Read even while reporting is off, for the results file.
   */
  projectCodes: string[];
  /** Core's `statusMapping` and `statusFilter`, once reporting can be on. */
  statusRules: StatusRules | undefined;
}

/**
 * The project codes whose ids are read from titles: the project, then those of `projects`. While
 * reporting is off, they are still read (as if it were on, without the token) for the results file,
 * whose results keep their case links.
 */
function projectCodesOf(resolution: ConfigResolution, options: ProbaraOptions, env: Env): string[] {
  const probe =
    resolution.ok || !resolution.disabled
      ? resolution
      : resolveConfig({ ...options, enabled: true, apiToken: 'PROBARA-TITLE-IDS' }, env);
  if (!probe.ok) return [];
  return [probe.config.projectId, ...probe.config.projects.map((project) => project.projectId)];
}

/**
 * The setup of an adapter's run: core's options with `rootDir` defaulting to the framework's, the
 * adapter's client name, a logger on stderr at the resolved `debug` (stdout belongs to the test
 * framework) unless the options give one, and the adapter's problems; plus the project codes and
 * the status rules the adapter counts results with. `options` are the user's, without the settings
 * only the adapter has. Throws only if reading the options does.
 */
export function resolveAdapterSetup(
  options: ProbaraOptions & RuntimeOptions,
  context: AdapterSetupContext,
): AdapterSetup {
  const env = options.env ?? process.env;
  const resolved: ProbaraOptions & RuntimeOptions = {
    ...options,
    rootDir: options.rootDir ?? context.rootDir,
    clientName: context.clientName,
  };
  const resolution = resolveConfig(resolved, env);
  const debug = resolution.ok
    ? resolution.config.debug
    : (resolveBooleanSetting(options.debug, 'debug', 'PROBARA_DEBUG', env).value ?? false);
  const logger: Logger = options.logger ?? createConsoleLogger({ debug, stderr: true });
  const adapterProblems = context.adapterProblems ?? [];
  return {
    core: {
      ...resolved,
      logger,
      ...(adapterProblems.length === 0 ? {} : { adapterProblems: [...adapterProblems] }),
    },
    projectCodes: projectCodesOf(resolution, resolved, env),
    statusRules: resolution.ok ? resolution.config : undefined,
  };
}

/**
 * Whether every case `input` links belongs to a project that is neither the configured one nor one
 * of `projects` (`projectCodes`): core drops each of those results (see `projectOfCase`).
 */
export function linksOnlyUnlistedProjects(
  input: TestResultInput,
  projectCodes: readonly string[],
): boolean {
  const ids =
    input.caseDisplayIds ?? (input.caseDisplayId === undefined ? [] : [input.caseDisplayId]);
  if (projectCodes.length === 0 || ids.length === 0) return false;
  return ids.every((id) => {
    const code = parseCaseDisplayId(id.trim())?.projectCode;
    return code !== undefined && !projectCodes.includes(code);
  });
}

/** What an adapter session counts with; each part can come later than the session. */
export interface AdapterSessionOptions {
  /** Where `warnOnce` writes; nothing is written without one. */
  logger?: Logger | undefined;
  /** Core's status rules (`AdapterSetup.statusRules`); none by default. */
  statusRules?: StatusRules | undefined;
  /** The configured project codes (`AdapterSetup.projectCodes`). */
  projectCodes?: readonly string[] | undefined;
}

/** The bookkeeping of one adapter run. */
export interface AdapterSession {
  /** A warning the first time, then at debug: the same problem tends to repeat in every test. */
  warnOnce(message: string, where: string): void;
  /** Counts an attempt `probara.ignore()` left out (not handed to core). */
  countIgnored(): void;
  /**
   * Counts a result handed to `addResult` as core sends it: mapped by `statusMapping`, left out by
   * `statusFilter`, or dropped as linked only to cases of unlisted projects. `test` identifies its
   * test, so the attempts of one test count as one test.
   */
  count(input: TestResultInput, test: unknown): void;
  /**
   * `Sending 3 results of 2 tests (1 passed, 1 failed, 1 skipped, 0 blocked)`, then what was left
   * out; `undefined` when nothing was counted. Log it at info before `complete()`, and only while
   * the reporter is `enabled` (core logs the results file it writes instead).
   */
  summaryLine(): string | undefined;
}

function plural(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? '' : 's'}`;
}

/** The counts and warnings of one adapter run, for its `Sending N results` line. */
export function createAdapterSession(options: AdapterSessionOptions = {}): AdapterSession {
  const rules: StatusRules = options.statusRules ?? { statusMapping: {}, statusFilter: [] };
  const projectCodes = options.projectCodes ?? [];
  const warned = new Set<string>();
  const tests = new Set<unknown>();
  const counts: Record<ResultStatus, number> = { passed: 0, failed: 0, skipped: 0, blocked: 0 };
  let filtered = 0;
  let ignored = 0;
  let dropped = 0;

  return {
    warnOnce(message, where) {
      if (warned.has(message)) {
        options.logger?.debug(`${message} (${where})`);
        return;
      }
      warned.add(message);
      options.logger?.warn(`${message} (first seen in ${where}; repeats are logged at debug)`);
    },
    countIgnored() {
      ignored += 1;
    },
    count(input, test) {
      const { status, filtered: left } = applyStatusRules(input.status, rules);
      if (left) filtered += 1;
      else if (linksOnlyUnlistedProjects(input, projectCodes)) dropped += 1;
      else {
        tests.add(test);
        counts[status] += 1;
      }
    },
    summaryLine() {
      const { passed, failed, skipped, blocked } = counts;
      const results = passed + failed + skipped + blocked;
      if (results + filtered + ignored + dropped === 0) return undefined;
      const left = [
        ...(filtered === 0 ? [] : [`; ${filtered} left out by statusFilter`]),
        ...(ignored === 0 ? [] : [`; ${ignored} ignored with probara.ignore()`]),
        ...(dropped === 0 ? [] : [`; ${dropped} linked only to cases of unlisted projects`]),
      ].join('');
      return `Sending ${plural(results, 'result')} of ${plural(tests.size, 'test')} (${passed} passed, ${failed} failed, ${skipped} skipped, ${blocked} blocked)${left}`;
    },
  };
}

/**
 * Logs one error line of the adapter, without the token of `options` or of its environment, even
 * before its setup is known: to `logger`, else the options' logger, else the console's stderr.
 * Never throws.
 */
export function logAdapterError(message: string, options: unknown, logger?: Logger): void {
  try {
    const given: ProbaraOptions & RuntimeOptions = isOptionsObject(options) ? options : {};
    const env = given.env ?? process.env;
    const target = logger ?? given.logger ?? createConsoleLogger({ debug: false, stderr: true });
    target.error(redact(message, secretsOf(given, env)));
  } catch {
    // Logging must never break the test run either.
  }
}
