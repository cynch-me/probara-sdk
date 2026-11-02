/**
 * `probara sync gherkin <globs...>`: the scenarios of `.feature` files made the project's synced
 * cases, through core's client. Every file is parsed and checked before anything is sent.
 */
import { readFile } from 'node:fs/promises';
import {
  createClient,
  createIdempotencyKey,
  ProbaraApiError,
  ProbaraNetworkError,
  type GherkinSyncCaseOutcome,
  type GherkinSyncFeature,
  type GherkinSyncRequest,
  type GherkinSyncResponse,
  type ProbaraOptions,
} from '@probara/core';
import { resolveSetup } from '../configuration.js';
import { EXIT_OK, EXIT_REPORTING_FAILED, EXIT_USAGE } from '../exit-codes.js';
import { displayPath, matchFiles } from '../files.js';
import { fileUrlOf, fileUrlTemplateOf } from '../gherkin/file-url.js';
import { parseFeature, type FeatureProblem } from '../gherkin/parse.js';
import type { GherkinFeature } from '../gherkin/features.js';
import {
  findDuplicateKeys,
  pathOf,
  scopeOf,
  syncFeatureOf,
  syncLimitProblems,
  syncProblemsOf,
} from '../gherkin/sync.js';
import { stringOf, toCoreOptions, UsageError, type ParsedCommandLine } from '../options.js';
import type { CommandContext } from './context.js';
import { plural } from './reporting.js';

const HELP = 'probara sync gherkin';
/** The outcomes that name their case on a line of their own: the ones a reader must see. */
const LISTED: readonly GherkinSyncCaseOutcome['action'][] = [
  'created',
  'updated',
  'moved',
  'archived',
  'restored',
];

function problemText(problem: FeatureProblem): string {
  const column = problem.column > 0 ? `:${problem.column}` : '';
  return `${problem.path}:${problem.line}${column}: ${problem.message}`;
}

/** One line of an outcome: its action, its display ID and its key (moves show both keys). */
function caseLine(outcome: GherkinSyncCaseOutcome): string {
  const id = outcome.caseDisplayId ?? '-';
  const key =
    outcome.action === 'moved'
      ? `${outcome.previousAutomationKey ?? ''} → ${outcome.automationKey}`
      : outcome.automationKey;
  return `${outcome.action}  ${id}  ${key}`;
}

export async function syncGherkin(
  { values, positionals }: ParsedCommandLine,
  { io, logger, output }: CommandContext,
  clientName: string,
): Promise<number> {
  if (positionals.length === 0) {
    throw new UsageError('Missing the .feature files (or globs, or directories) to sync', HELP);
  }
  const dryRun = values.get('dry-run') === true;
  const json = values.get('json') === true;
  const options: ProbaraOptions = {
    rootDir: io.cwd,
    ...toCoreOptions('sync gherkin', values, io.cwd),
    clientName,
    // A dry run shows the outcome a sync would have, whether or not reporting is turned on.
    ...(dryRun ? { enabled: true } : {}),
  };
  const rootDir = options.rootDir ?? io.cwd;

  const setup = resolveSetup(options, io.env, { requireCredentials: true, now: io.now });
  logger.debugEnabled = setup.kind === 'ready' ? setup.config.debug : values.get('debug') === true;
  for (const warning of setup.warnings) logger.warn(warning);
  if (setup.kind === 'invalid') {
    for (const problem of setup.problems) logger.error(problem);
    logger.error('Nothing was sent.');
    return EXIT_USAGE;
  }

  const matched = await matchFiles(positionals, io.cwd, { directoryGlob: '**/*.feature' });
  if (matched.files.length === 0) {
    throw new UsageError(`No .feature file matched ${positionals.join(', ')}`, HELP);
  }
  for (const pattern of matched.unmatched) logger.warn(`No file matched ${pattern}`);

  // Every file is read and checked before anything is sent: one that fails sends nothing.
  const errors: string[] = [];
  const parsed: { path: string; feature: GherkinFeature }[] = [];
  for (const file of matched.files) {
    const shown = displayPath(file, io.cwd);
    const path = pathOf(file, rootDir);
    if (path === undefined) {
      errors.push(`${shown}: is outside the root directory (--root-dir)`);
      continue;
    }
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      errors.push(
        `${shown}: could not be read (${typeof code === 'string' ? code : String(error)})`,
      );
      continue;
    }
    const result = parseFeature(text, path);
    if (!result.ok) {
      errors.push(...result.problems.map(problemText));
      continue;
    }
    if (result.feature === undefined) {
      logger.warn(`${path} has no Feature: nothing is synced from it`);
      continue;
    }
    errors.push(...syncProblemsOf(path, result.feature));
    parsed.push({ path, feature: result.feature });
  }

  const template = fileUrlTemplateOf(stringOf(values, 'file-url'), io.env);
  if (template !== undefined && fileUrlOf(template, 'probe.feature', 1) === undefined) {
    logger.warn('The link template does not give an https link: the cases get no link');
  }
  const features: GherkinSyncFeature[] = parsed.map(({ path, feature }) =>
    syncFeatureOf(path, feature, {
      rootDir,
      ...(template === undefined ? {} : { urlOf: (line) => fileUrlOf(template, path, line) }),
    }),
  );

  const keyed = features.flatMap((feature) =>
    feature.scenarios.map((scenario) => ({
      path: feature.path,
      line: scenario.line,
      key: scenario.automationKey,
    })),
  );
  errors.push(...findDuplicateKeys(keyed));
  const scope = await scopeOf(positionals, io.cwd, rootDir);
  errors.push(...syncLimitProblems({ scenarios: keyed.length, scopeGlobs: scope.length }));
  if (errors.length > 0) {
    for (const error of errors) logger.error(error);
    logger.error(`Nothing was sent: ${plural(errors.length, 'problem')} to fix first.`);
    return EXIT_USAGE;
  }

  if (setup.kind === 'disabled') {
    logger.info(`${setup.reason}: nothing was sent`);
    return EXIT_OK;
  }
  const { config } = setup;
  logger.info(
    `Files: ${plural(features.length, 'feature file')}, ${plural(keyed.length, 'scenario')}`,
  );
  logger.info(`Project: ${config.projectId}`);
  logger.info(`Base URL: ${config.baseUrl}`);

  const request: GherkinSyncRequest = {
    scope,
    ...(config.suiteUlid === undefined ? {} : { suiteUlid: config.suiteUlid }),
    ...(dryRun ? { dryRun: true } : {}),
    features,
  };
  const client = createClient({
    baseUrl: config.baseUrl,
    apiToken: config.apiToken,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    clientName,
    logger,
    ...(io.fetch === undefined ? {} : { fetch: io.fetch }),
    ...(io.sleep === undefined ? {} : { sleep: io.sleep }),
    ...(io.now === undefined ? {} : { now: () => io.now?.().getTime() ?? Date.now() }),
  });

  let answer: GherkinSyncResponse;
  try {
    answer = await client.syncGherkin(config.projectId, request, {
      idempotencyKey: createIdempotencyKey(),
    });
  } catch (error) {
    if (error instanceof ProbaraApiError || error instanceof ProbaraNetworkError) {
      logger.error(error.message);
      return EXIT_REPORTING_FAILED;
    }
    throw error;
  }

  const { summary } = answer;
  const verb = answer.dryRun ? 'Would be created' : 'Created';
  logger.info(
    `${verb} ${summary.created}, updated ${summary.updated}, moved ${summary.moved}, restored ${summary.restored}, archived ${summary.archived}, unchanged ${summary.unchanged}`,
  );
  for (const outcome of answer.cases) {
    if (LISTED.includes(outcome.action)) logger.info(caseLine(outcome));
  }
  if (dryRun) logger.info('Dry run: nothing was written');
  if (json) output.json(answer);
  return EXIT_OK;
}
