/**
 * The Feature of a `.feature` file as the sync and the Cucumber import read it: its scenarios and
 * their steps as written, with each line the file gives them. A Rule is a scenario's `rule`, and its
 * Background follows the feature's: the steps that run before the scenario.
 */
import type {
  Background,
  Examples,
  Feature,
  GherkinDocument,
  Rule,
  Scenario,
  Step,
  Tag,
} from '@cucumber/messages';

export interface GherkinStep {
  /** The keyword as written, trimmed: `Given`, `When`, `Then`, `And`, `But` or `*`, or another language's. */
  keyword: string;
  text: string;
  line: number;
  /** The content of a Doc String argument, without its delimiters. */
  docString?: string;
  /** The rows of a Data Table argument: each row's cell values, unescaped. */
  table?: string[][];
}

export interface GherkinExampleRow {
  line: number;
  cells: string[];
}

export interface GherkinExamples {
  name: string;
  header: string[];
  rows: GherkinExampleRow[];
}

export interface GherkinRule {
  name: string;
  tags: string[];
}

export interface GherkinScenario {
  name: string;
  /** The line of the `Scenario:` keyword (of a Scenario Outline: its keyword, not its Examples). */
  line: number;
  description: string;
  /** The tag names, without their `@`. */
  tags: string[];
  rule?: GherkinRule;
  /** The Background steps before the scenario: the feature's, then its Rule's. */
  background: GherkinStep[];
  steps: GherkinStep[];
  /** The Examples of a Scenario Outline; none for a plain scenario. */
  examples: GherkinExamples[];
}

export interface GherkinFeature {
  name: string;
  line: number;
  description: string;
  /** The tag names, without their `@`. */
  tags: string[];
  scenarios: GherkinScenario[];
}

/**
 * The text of a description: the indentation all its lines share, and the spaces at the end of each
 * line, removed; blank lines at its start and end dropped.
 */
export function dedent(text: string): string {
  const lines = text.split('\n').map((line) => line.trimEnd());
  const start = lines.findIndex((line) => line.trim() !== '');
  if (start === -1) return '';
  const end = lines.length - 1 - [...lines].reverse().findIndex((line) => line.trim() !== '');
  const body = lines.slice(start, end + 1);
  const indent = Math.min(
    ...body
      .filter((line) => line.trim() !== '')
      .map((line) => line.length - line.trimStart().length),
  );
  return body.map((line) => line.slice(Math.min(indent, line.length))).join('\n');
}

function tagNames(tags: readonly Tag[]): string[] {
  return tags.map((tag) => tag.name.replace(/^@/, ''));
}

function stepOf(step: Step): GherkinStep {
  return {
    keyword: step.keyword.trim(),
    text: step.text.trim(),
    line: step.location.line,
    ...(step.docString === undefined ? {} : { docString: step.docString.content }),
    ...(step.dataTable === undefined
      ? {}
      : { table: step.dataTable.rows.map((row) => row.cells.map((cell) => cell.value)) }),
  };
}

function examplesOf(examples: Examples): GherkinExamples {
  return {
    name: examples.name.trim(),
    header: examples.tableHeader?.cells.map((cell) => cell.value) ?? [],
    rows: examples.tableBody.map((row) => ({
      line: row.location.line,
      cells: row.cells.map((cell) => cell.value),
    })),
  };
}

function scenarioOf(
  scenario: Scenario,
  background: readonly GherkinStep[],
  rule?: GherkinRule,
): GherkinScenario {
  return {
    name: scenario.name.trim(),
    line: scenario.location.line,
    description: dedent(scenario.description),
    tags: tagNames(scenario.tags),
    ...(rule === undefined ? {} : { rule }),
    background: [...background],
    steps: scenario.steps.map(stepOf),
    examples: scenario.examples.map(examplesOf),
  };
}

/**
 * The Feature of a document, or `undefined` for a document with none (a file of comments). A
 * Background comes before the scenarios it applies to, as the Gherkin grammar requires.
 */
export function featureOf(document: GherkinDocument): GherkinFeature | undefined {
  const feature: Feature | undefined = document.feature;
  if (feature === undefined) return undefined;

  let featureBackground: readonly Background[] = [];
  const scenarios: GherkinScenario[] = [];
  for (const child of feature.children) {
    if (child.background !== undefined) featureBackground = [child.background];
    if (child.scenario !== undefined) {
      scenarios.push(scenarioOf(child.scenario, backgroundSteps(featureBackground)));
    }
    if (child.rule !== undefined) {
      scenarios.push(...scenariosOfRule(child.rule, backgroundSteps(featureBackground)));
    }
  }
  return {
    name: feature.name.trim(),
    line: feature.location.line,
    description: dedent(feature.description),
    tags: tagNames(feature.tags),
    scenarios,
  };
}

function backgroundSteps(backgrounds: readonly Background[]): GherkinStep[] {
  return backgrounds.flatMap((background) => background.steps.map(stepOf));
}

function scenariosOfRule(rule: Rule, featureSteps: readonly GherkinStep[]): GherkinScenario[] {
  const shape: GherkinRule = { name: rule.name.trim(), tags: tagNames(rule.tags) };
  let ruleBackground: readonly Background[] = [];
  const scenarios: GherkinScenario[] = [];
  for (const child of rule.children) {
    if (child.background !== undefined) ruleBackground = [child.background];
    if (child.scenario !== undefined) {
      scenarios.push(
        scenarioOf(child.scenario, [...featureSteps, ...backgroundSteps(ruleBackground)], shape),
      );
    }
  }
  return scenarios;
}
