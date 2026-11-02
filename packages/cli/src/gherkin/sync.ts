/**
 * What a `sync gherkin` sends: each `.feature` file as a feature, its scenarios keyed by
 * `<path> > <Feature> > <Scenario>` (key v1), with the scope the files were matched with.
 */
import { stat } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import {
  buildAutomationKey,
  isStepKeyword,
  tableText,
  type GherkinSyncFeature,
  type GherkinSyncScenario,
  type GherkinSyncStep,
} from '@probara/core';
import type { GherkinExamples, GherkinFeature, GherkinStep } from './features.js';

/** Scenarios per sync: a larger repository syncs folder by folder, each with its own scope. */
export const SYNC_SCENARIO_LIMIT = 1_000;
/** Scope globs per sync. */
export const SYNC_SCOPE_LIMIT = 20;

/** `1234567` as `1,234,567`. */
function grouped(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The automation key of a scenario: its file relative to the root, its Feature and its Scenario. */
export function automationKeyOf(
  path: string,
  featureName: string,
  scenarioName: string,
  rootDir: string,
): string {
  return buildAutomationKey({ file: path, titlePath: [featureName, scenarioName] }, { rootDir });
}

/** The POSIX path of `file` relative to the root directory, or `undefined` outside it. */
export function pathOf(file: string, rootDir: string): string | undefined {
  const path = relative(rootDir, file).split(sep).join('/');
  if (path === '' || path === '..' || path.startsWith('../') || isAbsolute(path)) return undefined;
  return path;
}

/** A path as a glob that matches exactly that path: its glob characters escaped. */
export function escapeGlob(path: string): string {
  return path.replace(/[*?[\]{}()!+@|\\]/g, '\\$&');
}

async function kindOf(path: string): Promise<'file' | 'directory' | undefined> {
  try {
    const stats = await stat(path);
    return stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The scope of a sync: each command line argument as a glob relative to the root directory. A
 * file is itself, a directory is every `.feature` file beneath it, and a glob is kept as written,
 * re-based on the working directory when that is below the root.
 */
export async function scopeOf(
  patterns: readonly string[],
  cwd: string,
  rootDir: string,
): Promise<string[]> {
  const base = relative(rootDir, cwd).split(sep).join('/');
  return Promise.all(
    patterns.map(async (pattern) => {
      const absolute = resolve(cwd, pattern);
      const kind = await kindOf(absolute);
      if (kind === 'file') return escapeGlob(relative(rootDir, absolute).split(sep).join('/'));
      if (kind === 'directory') {
        return posix.join(relative(rootDir, absolute).split(sep).join('/'), '**', '*.feature');
      }
      if (isAbsolute(pattern)) return relative(rootDir, pattern).split(sep).join('/');
      return posix.normalize(posix.join(base, pattern));
    }),
  );
}

/** The step keyword and text of a sync step, with its argument: a Doc String, or a Data Table. */
function syncStepOf(step: GherkinStep): GherkinSyncStep {
  const argument = step.docString ?? (step.table === undefined ? undefined : tableText(step.table));
  return {
    // Checked by `syncProblemsOf` before a feature is sent.
    keyword: step.keyword as GherkinSyncStep['keyword'],
    text: step.text,
    ...(argument === undefined ? {} : { argument }),
  };
}

function syncExamplesOf(examples: GherkinExamples) {
  return {
    ...(examples.name === '' ? {} : { name: examples.name }),
    header: examples.header,
    rows: examples.rows.map((row) => row.cells),
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export interface SyncFeatureOptions {
  rootDir: string;
  /** The link of a scenario's line, when there is one. */
  urlOf?: (line: number) => string | undefined;
}

/** A feature as the sync sends it: its scenarios keyed, with their steps, Background and Examples. */
export function syncFeatureOf(
  path: string,
  feature: GherkinFeature,
  options: SyncFeatureOptions,
): GherkinSyncFeature {
  return {
    path,
    name: feature.name,
    ...(feature.description === '' ? {} : { description: feature.description }),
    tags: unique(feature.tags),
    scenarios: feature.scenarios.map((scenario): GherkinSyncScenario => {
      const url = options.urlOf?.(scenario.line);
      return {
        automationKey: automationKeyOf(path, feature.name, scenario.name, options.rootDir),
        name: scenario.name,
        line: scenario.line,
        ...(scenario.description === '' ? {} : { description: scenario.description }),
        tags: unique(scenario.tags),
        ...(scenario.rule === undefined
          ? {}
          : { rule: { name: scenario.rule.name, tags: unique(scenario.rule.tags) } }),
        ...(scenario.background.length === 0
          ? {}
          : { background: scenario.background.map(syncStepOf) }),
        steps: scenario.steps.map(syncStepOf),
        ...(scenario.examples.length === 0
          ? {}
          : { examples: scenario.examples.map(syncExamplesOf) }),
        ...(url === undefined ? {} : { url }),
      };
    }),
  };
}

/**
 * What stops a feature from being sent, each as a message with its path and line: a Feature or a
 * scenario without a name (its key would lose a segment), a step keyword other than the English
 * ones, and a step without text.
 */
export function syncProblemsOf(path: string, feature: GherkinFeature): string[] {
  const problems: string[] = [];
  if (feature.name === '') problems.push(`${path}:${feature.line}: the Feature has no name`);
  const checkStep = (step: GherkinStep) => {
    if (!isStepKeyword(step.keyword)) {
      problems.push(
        `${path}:${step.line}: the step keyword "${step.keyword}" is not English: Probara reads Given, When, Then, And, But and * only`,
      );
    }
    if (step.text === '') problems.push(`${path}:${step.line}: the step has no text`);
  };
  for (const scenario of feature.scenarios) {
    if (scenario.name === '') {
      problems.push(`${path}:${scenario.line}: the Scenario has no name`);
    }
    scenario.background.forEach(checkStep);
    scenario.steps.forEach(checkStep);
  }
  return problems;
}

/** Each key that two scenarios share, named by both `path:line` places. */
export function findDuplicateKeys(
  entries: readonly { path: string; line: number; key: string }[],
): string[] {
  const first = new Map<string, { path: string; line: number }>();
  const problems: string[] = [];
  for (const entry of entries) {
    const earlier = first.get(entry.key);
    if (earlier === undefined) {
      first.set(entry.key, entry);
      continue;
    }
    problems.push(
      `${earlier.path}:${earlier.line} and ${entry.path}:${entry.line} have the same automation key "${entry.key}": give one of them another name`,
    );
  }
  return problems;
}

/** What makes a sync too large, each as a message: sync the folders one by one instead. */
export function syncLimitProblems({
  scenarios,
  scopeGlobs,
}: {
  scenarios: number;
  scopeGlobs: number;
}): string[] {
  const problems: string[] = [];
  if (scenarios > SYNC_SCENARIO_LIMIT) {
    problems.push(
      `a sync carries at most ${grouped(SYNC_SCENARIO_LIMIT)} scenarios, this one has ${grouped(scenarios)}: sync each folder with its own glob`,
    );
  }
  if (scopeGlobs > SYNC_SCOPE_LIMIT) {
    problems.push(
      `a sync carries at most ${SYNC_SCOPE_LIMIT} globs, this one has ${scopeGlobs}: sync each folder with its own glob`,
    );
  }
  return problems;
}
