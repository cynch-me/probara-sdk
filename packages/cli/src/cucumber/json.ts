/**
 * Cucumber JSON reports as results. Each scenario, and each row of a Scenario Outline, is one
 * result; each step is one result step, and the Background steps of a scenario sit under one
 * `Background` step. A feature file that is there keys its scenarios as the sync does (an outline
 * keeps its written name, and its row's values are the parameters of the result); one that is not
 * keys them by the names in the report.
 */
import { isAbsolute, posix, relative, sep } from 'node:path';
import type { ResultStatus, TestResultInput, TestStepInput } from '@probara/core';
import { parseFeature } from '../gherkin/parse.js';
import type { GherkinExamples, GherkinFeature, GherkinScenario } from '../gherkin/features.js';
import { isStepKeyword, tableText } from '../gherkin/steps.js';

type Json = Record<string, unknown>;

/** The message of an ambiguous step: Cucumber's report carries none. */
const AMBIGUOUS = 'Ambiguous step: more than one step definition matches it';
const HOOK_FAILED = 'The hook failed';
const NANOSECONDS_PER_MS = 1_000_000;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The items of a list, or none when the value is not one. */
function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/** The objects of a list. */
function recordsOf(value: unknown): Json[] {
  return listOf(value).filter(isRecord);
}

export type CucumberFeatures = { ok: true; features: Json[] } | { ok: false; error: string };

/** The features of a Cucumber JSON report: an array of objects, one per feature. */
export function cucumberFeaturesOf(text: string): CucumberFeatures {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `is not valid JSON: ${reason}` };
  }
  if (!Array.isArray(parsed) || !parsed.every(isRecord)) {
    return { ok: false, error: 'is not a Cucumber JSON report: expected an array of features' };
  }
  return { ok: true, features: parsed };
}

export interface CucumberReading {
  results: TestResultInput[];
  /** What the import says once per feature file: the file is not there, or it has no Feature. */
  notes: string[];
  /** Scenarios skipped, or keyed by the names in the report, each naming its file. */
  warnings: string[];
  /** Feature files that do not parse as Gherkin: nothing of them is sent. */
  errors: string[];
}

export interface CucumberReadingOptions {
  /** The directory the paths of the feature files are relative to. */
  rootDir: string;
  /** The text of the feature file at a path relative to the root, or `undefined` when it is not there. */
  readFeature: (path: string) => Promise<string | undefined>;
}

/** The path of a feature file relative to the root, from the `uri` of a report; `undefined` outside it. */
function pathOfUri(uri: string, rootDir: string): string | undefined {
  let text = uri.trim();
  if (text.startsWith('file:')) {
    try {
      text = decodeURIComponent(new URL(text).pathname);
    } catch {
      return undefined;
    }
  }
  text = text.replace(/\\/g, '/');
  const path = isAbsolute(text)
    ? relative(rootDir, text).split(sep).join('/')
    : posix.normalize(text);
  if (path === '' || path === '..' || path.startsWith('../') || isAbsolute(path)) return undefined;
  return path;
}

function directoriesOf(path: string): string[] {
  return path.split('/').slice(0, -1);
}

/** A scenario of the file at a line, and for an outline row, its Examples and the row's cells. */
interface LineMatch {
  scenario: GherkinScenario;
  row?: { examples: GherkinExamples; cells: string[] };
}

/** Every scenario and outline row of a feature, by the line the report gives it. */
function matchesOf(feature: GherkinFeature): Map<number, LineMatch> {
  const matches = new Map<number, LineMatch>();
  for (const scenario of feature.scenarios) {
    matches.set(scenario.line, { scenario });
    for (const examples of scenario.examples) {
      for (const row of examples.rows) {
        matches.set(row.line, { scenario, row: { examples, cells: row.cells } });
      }
    }
  }
  return matches;
}

function parametersOf(row: NonNullable<LineMatch['row']>): Record<string, string> | undefined {
  if (row.examples.header.length === 0) return undefined;
  return Object.fromEntries(
    row.examples.header.map((name, index) => [name, row.cells[index] ?? '']),
  );
}

/** A step's status as Probara records it: undefined, pending and skipped steps did not run. */
function statusOf(status: unknown): ResultStatus {
  if (status === 'passed') return 'passed';
  if (status === 'failed' || status === 'ambiguous') return 'failed';
  return 'skipped';
}

/** A scenario fails when a step failed, is skipped when a step did not run, and passes otherwise. */
function rollup(statuses: readonly ResultStatus[]): ResultStatus {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('skipped')) return 'skipped';
  return 'passed';
}

function nanosecondsOf(result: Json): number {
  const { duration } = result;
  return typeof duration === 'number' && Number.isFinite(duration) ? duration : 0;
}

function errorOf(result: Json, status: ResultStatus): string | undefined {
  if (status !== 'failed') return undefined;
  const message = typeof result.error_message === 'string' ? result.error_message.trim() : '';
  if (message !== '') return message;
  return result.status === 'ambiguous' ? AMBIGUOUS : undefined;
}

/** The data of a step: its Doc String content, or its Data Table as lines of pipes. */
function dataOf(step: Json): string | undefined {
  if (isRecord(step.doc_string) && typeof step.doc_string.content === 'string') {
    return step.doc_string.content;
  }
  for (const argument of recordsOf(step.arguments)) {
    if (typeof argument.content === 'string') return argument.content;
    if (Array.isArray(argument.rows)) {
      return tableText(
        listOf(argument.rows).map((row) =>
          isRecord(row)
            ? listOf(row.cells).map((cell) => (typeof cell === 'string' ? cell : ''))
            : [],
        ),
      );
    }
  }
  return undefined;
}

interface ConvertedStep {
  step: TestStepInput;
  status: ResultStatus;
  /** The message of a failed step, as the result's error. */
  error?: string;
  nanoseconds: number;
  /** The line the step is on in the feature file, when the report gives it. */
  line?: number;
}

function convertStep(step: Json): ConvertedStep {
  const result = isRecord(step.result) ? step.result : {};
  const status = statusOf(result.status);
  const keyword = typeof step.keyword === 'string' ? step.keyword.trim() : '';
  const error = errorOf(result, status);
  const data = dataOf(step);
  const name = typeof step.name === 'string' ? step.name.trim() : '';
  return {
    step: {
      action: name,
      status,
      durationMs: Math.round(nanosecondsOf(result) / NANOSECONDS_PER_MS),
      ...(isStepKeyword(keyword) ? { keyword } : {}),
      ...(error === undefined ? {} : { error }),
      ...(data === undefined ? {} : { data }),
    },
    status,
    ...(error === undefined ? {} : { error }),
    nanoseconds: nanosecondsOf(result),
    ...(typeof step.line === 'number' ? { line: step.line } : {}),
  };
}

/** The hooks of a scenario: its hidden steps, then its `before` and `after` hooks. */
function hooksOf(element: Json): Json[] {
  const steps = recordsOf(element.steps);
  const hooks = [...listOf(element.before), ...listOf(element.after)].filter(isRecord);
  return [...steps.filter((step) => step.hidden === true), ...hooks];
}

/**
 * The results of the features of a Cucumber JSON report. A feature file that is there is parsed,
 * and each scenario keyed by the names it has there; a scenario not at its line in it, or a file
 * that is not there, is keyed by the report's names, with a note or a warning.
 */
export async function resultsOfCucumber(
  features: readonly Json[],
  options: CucumberReadingOptions,
): Promise<CucumberReading> {
  const reading: CucumberReading = { results: [], notes: [], warnings: [], errors: [] };
  for (const feature of features) {
    const featureName = typeof feature.name === 'string' ? feature.name.trim() : '';
    const uri = typeof feature.uri === 'string' ? feature.uri : undefined;
    const path = uri === undefined ? undefined : pathOfUri(uri, options.rootDir);
    if (path === undefined) {
      reading.warnings.push(
        `skipped the feature "${featureName}": its uri is not a file under the root directory`,
      );
      continue;
    }

    const source = await options.readFeature(path);
    const parsed = source === undefined ? undefined : parseFeature(source, path);
    if (parsed !== undefined && !parsed.ok) {
      for (const problem of parsed.problems) {
        const column = problem.column > 0 ? `:${problem.column}` : '';
        reading.errors.push(`${problem.path}:${problem.line}${column}: ${problem.message}`);
      }
      continue;
    }
    const matched = parsed?.ok === true ? parsed.feature : undefined;
    if (source === undefined) {
      reading.notes.push(
        `${path} was not found: its scenarios are keyed by the names in the report`,
      );
    } else if (matched === undefined) {
      reading.notes.push(
        `${path} has no Feature: its scenarios are keyed by the names in the report`,
      );
    }
    const matches = matched === undefined ? undefined : matchesOf(matched);
    let outlineWarned = false;

    const elements = recordsOf(feature.elements);
    for (const element of elements) {
      if (element.type === 'background') continue;
      const elementName = typeof element.name === 'string' ? element.name.trim() : '';
      if (elementName === '') {
        reading.warnings.push(`${path}: skipped a scenario without a name`);
        continue;
      }
      const line = typeof element.line === 'number' ? element.line : undefined;
      const match = line === undefined ? undefined : matches?.get(line);
      if (matches !== undefined && match === undefined) {
        reading.warnings.push(
          `${path}: no scenario is at line ${String(line)}: its key is built from the names in the report`,
        );
      }
      if (match === undefined && element.keyword === 'Scenario Outline' && !outlineWarned) {
        outlineWarned = true;
        reading.warnings.push(
          `${path}: the rows of a Scenario Outline are keyed by their names with the example values filled in, which match no synced case`,
        );
      }
      // A blank Feature name would lose its segment from the key: such a scenario is skipped.
      const featureTitle = match === undefined ? featureName : (matched?.name ?? '');
      if (featureTitle === '') {
        reading.warnings.push(`${path}: skipped a scenario of a feature without a name`);
        continue;
      }

      const scenarioSteps = recordsOf(element.steps);
      const visible = scenarioSteps.filter((step) => step.hidden !== true).map(convertStep);
      const backgroundLines = new Set(match?.scenario.background.map((step) => step.line));
      const isBackground = (converted: ConvertedStep) =>
        converted.line !== undefined && backgroundLines.has(converted.line);
      const background = visible.filter(isBackground);
      const own = visible.filter((converted) => !isBackground(converted));
      const hooks = hooksOf(element);
      const hookErrors = hooks.flatMap((hook) => {
        const result = isRecord(hook.result) ? hook.result : {};
        if (statusOf(result.status) !== 'failed') return [];
        return [errorOf(result, 'failed') ?? HOOK_FAILED];
      });

      const steps: TestStepInput[] = [];
      if (background.length > 0) {
        steps.push({
          action: 'Background',
          status: rollup(background.map((converted) => converted.status)),
          durationMs: Math.round(
            background.reduce((sum, converted) => sum + converted.nanoseconds, 0) /
              NANOSECONDS_PER_MS,
          ),
          steps: background.map((converted) => converted.step),
        });
      }
      steps.push(...own.map((converted) => converted.step));

      const failedSteps = [...background, ...own].flatMap((converted) =>
        converted.status === 'failed' && converted.error !== undefined ? [converted.error] : [],
      );
      const hookFailures = hookErrors.length;
      const status = rollup([
        ...[...background, ...own].map((converted) => converted.status),
        ...Array.from({ length: hookFailures }, (): ResultStatus => 'failed'),
      ]);
      const nanoseconds =
        [...background, ...own].reduce((sum, converted) => sum + converted.nanoseconds, 0) +
        hooks.reduce(
          (sum, hook) => sum + nanosecondsOf(isRecord(hook.result) ? hook.result : {}),
          0,
        );
      const errors = [...failedSteps, ...hookErrors];

      const row = match?.row;
      const parameters = row === undefined ? undefined : parametersOf(row);
      const rule = match?.scenario.rule;
      reading.results.push({
        identity: {
          file: path,
          titlePath: [featureTitle, match === undefined ? elementName : match.scenario.name],
        },
        status,
        title: match === undefined ? elementName : match.scenario.name,
        suitePath: [
          ...directoriesOf(path),
          featureTitle,
          ...(rule === undefined ? [] : [rule.name]),
        ],
        durationMs: Math.round(nanoseconds / NANOSECONDS_PER_MS),
        ...(parameters === undefined ? {} : { parameters }),
        ...(errors.length === 0 ? {} : { error: errors }),
        ...(steps.length === 0 ? {} : { steps }),
      });
    }
  }
  return reading;
}
