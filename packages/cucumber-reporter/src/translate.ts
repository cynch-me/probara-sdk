/**
 * One Cucumber attempt as a `@probara/core` result. Its identity is the key `sync gherkin` builds for
 * the scenario (`<path> > <Feature> > <Scenario>`, the Rule left out), and its steps, statuses, errors
 * and durations are the ones `probara import cucumber` sends for the same run, so a result lands on
 * the case its scenario was synced to.
 */
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  cucumberStepStatus,
  isStepKeyword,
  parseCaseDisplayId,
  scenarioStatus,
  tableText,
  type AttachmentInput,
  type ResultStatus,
  type TestResultInput,
  type TestStepInput,
} from '@probara/core';

/** The steps, examples and tags of a Gherkin document, as Cucumber's Messages carry them. */
export interface CucumberStep {
  readonly id: string;
  /** As written, with its separating space: `Given `. */
  readonly keyword: string;
  readonly text: string;
}

export interface CucumberExamples {
  readonly tableHeader?: { readonly cells: readonly { readonly value: string }[] } | undefined;
  readonly tableBody: readonly {
    readonly id: string;
    readonly cells: readonly { readonly value: string }[];
  }[];
}

export interface CucumberScenario {
  readonly id: string;
  /** The name as written: an outline keeps its `<placeholders>`. */
  readonly name: string;
  /** The scenario's own tags, with their `@`. */
  readonly tags: readonly { readonly name: string }[];
  readonly steps: readonly CucumberStep[];
  readonly examples: readonly CucumberExamples[];
}

export interface CucumberBackground {
  readonly id: string;
  readonly steps: readonly CucumberStep[];
}

export interface CucumberRule {
  readonly name: string;
  readonly children: readonly {
    readonly background?: CucumberBackground | undefined;
    readonly scenario?: CucumberScenario | undefined;
  }[];
}

export interface CucumberFeature {
  readonly name: string;
  readonly children: readonly {
    readonly background?: CucumberBackground | undefined;
    readonly scenario?: CucumberScenario | undefined;
    readonly rule?: CucumberRule | undefined;
  }[];
}

export interface CucumberGherkinDocument {
  readonly uri?: string | undefined;
  readonly feature?: CucumberFeature | undefined;
}

/** A step of the pickle: the scenario's step with its outline values filled in. */
export interface CucumberPickleStep {
  readonly id: string;
  readonly text: string;
  /** The Gherkin step first, then the step's own nodes. */
  readonly astNodeIds: readonly string[];
  readonly argument?:
    | {
        readonly docString?: { readonly content: string } | undefined;
        readonly dataTable?:
          | { readonly rows: readonly { readonly cells: readonly { readonly value: string }[] }[] }
          | undefined;
      }
    | undefined;
}

export interface CucumberPickle {
  readonly id: string;
  readonly uri: string;
  /** The name with the outline values filled in: not the key. */
  readonly name: string;
  readonly steps: readonly CucumberPickleStep[];
  /** The scenario, then the Examples row of an outline. */
  readonly astNodeIds: readonly string[];
}

/** A step of the test case: a pickle step, or a hook (`hookId`, no `pickleStepId`). */
export interface CucumberTestStep {
  readonly id: string;
  readonly pickleStepId?: string | undefined;
  readonly hookId?: string | undefined;
}

export interface CucumberStepResult {
  /** `PASSED` (Messages) or `passed` (the JSON report); both are read. */
  readonly status: string;
  readonly message?: string | undefined;
  readonly duration: { readonly seconds: number; readonly nanos: number };
}

export interface CucumberAttachment {
  readonly body: string;
  /** `IDENTITY` (the body is text) or `BASE64`. */
  readonly contentEncoding: string;
  readonly mediaType: string;
  readonly fileName?: string | undefined;
}

/** One attempt of a test case, as the event data collector of Cucumber hands it over. */
export interface CucumberAttempt {
  readonly attempt: number;
  readonly willBeRetried: boolean;
  readonly gherkinDocument: CucumberGherkinDocument;
  readonly pickle: CucumberPickle;
  readonly testCase: { readonly testSteps: readonly CucumberTestStep[] };
  readonly stepResults: Readonly<Record<string, CucumberStepResult | undefined>>;
  readonly stepAttachments: Readonly<Record<string, readonly CucumberAttachment[] | undefined>>;
}

export interface AttemptContext {
  /** The directory Cucumber runs in: the feature URIs are relative to it. */
  cwd: string;
  /** The directory the feature paths are relative to (the `rootDir` option, else `cwd`). */
  rootDir: string;
  /** When the attempt started (the `testCaseStarted` message). */
  startedAt?: Date | undefined;
}

/** The result of one attempt, or none with the problems that kept it from being sent. */
export interface Attempt {
  input?: TestResultInput;
  /** What is left out or ignored, one line each, for the warnings. */
  problems: string[];
}

/** The message of an ambiguous step: Cucumber's report carries none. */
const AMBIGUOUS = 'Ambiguous step: more than one step definition matches it';
const HOOK_FAILED = 'The hook failed';
const NANOSECONDS_PER_MS = 1_000_000;
const NANOSECONDS_PER_SECOND = 1_000_000_000;
const AMBIGUOUS_STATUSES: ReadonlySet<string> = new Set(['ambiguous', 'AMBIGUOUS']);
/** The tag that binds a scenario to a case, as the sync reads it: `@probara:SHOP-12`. */
const PROBARA_TAG = 'probara:';
/** What `this.log(...)` attaches, and what `this.link(...)` attaches. */
const LOG_MEDIA_TYPE = 'text/x.cucumber.log+plain';
const LINK_MEDIA_TYPE = 'text/uri-list';

/** The path of a feature relative to the root, with `/` separators; `undefined` outside it. */
function pathOf(uri: string, context: AttemptContext): string | undefined {
  const path = relative(context.rootDir, resolve(context.cwd, uri)).split(sep).join('/');
  return path === '' || path === '..' || path.startsWith('../') || isAbsolute(path)
    ? undefined
    : path;
}

function nanosecondsOf(duration: CucumberStepResult['duration']): number {
  return duration.seconds * NANOSECONDS_PER_SECOND + duration.nanos;
}

function millisecondsOf(nanoseconds: number): number {
  return Math.round(nanoseconds / NANOSECONDS_PER_MS);
}

/** A step's error: its message, or the ambiguity text for an ambiguous step; none unless it failed. */
function errorOf(result: CucumberStepResult, status: ResultStatus): string | undefined {
  if (status !== 'failed') return undefined;
  const message = result.message?.trim() ?? '';
  if (message !== '') return message;
  return AMBIGUOUS_STATUSES.has(result.status) ? AMBIGUOUS : undefined;
}

/** The data of a step: its Doc String content, or its Data Table as lines of pipes. */
function dataOf(argument: CucumberPickleStep['argument']): string | undefined {
  if (argument === undefined) return undefined;
  if (argument.docString !== undefined) return argument.docString.content;
  if (argument.dataTable !== undefined) {
    return tableText(argument.dataTable.rows.map((row) => row.cells.map((cell) => cell.value)));
  }
  return undefined;
}

/** An attachment as a file of the result: a log or a link as text, the rest as the media type says. */
function fileOf(attachment: CucumberAttachment): AttachmentInput {
  if (attachment.mediaType === LOG_MEDIA_TYPE) {
    return { name: 'log', contentType: 'text/plain', body: attachment.body };
  }
  if (attachment.mediaType === LINK_MEDIA_TYPE) {
    return { name: 'link', contentType: 'text/plain', body: attachment.body };
  }
  const body =
    attachment.contentEncoding === 'BASE64'
      ? Buffer.from(attachment.body, 'base64')
      : attachment.body;
  return {
    name: attachment.fileName ?? 'attachment',
    contentType: attachment.mediaType,
    body,
  };
}

/** The steps of a feature by id: those of its Background and of its scenarios, Rules included. */
function stepsOf(feature: CucumberFeature): Map<string, CucumberStep> {
  const steps = new Map<string, CucumberStep>();
  const add = (list: readonly CucumberStep[]) => {
    for (const step of list) steps.set(step.id, step);
  };
  for (const child of feature.children) {
    if (child.background !== undefined) add(child.background.steps);
    if (child.scenario !== undefined) add(child.scenario.steps);
    for (const ruleChild of child.rule?.children ?? []) {
      if (ruleChild.background !== undefined) add(ruleChild.background.steps);
      if (ruleChild.scenario !== undefined) add(ruleChild.scenario.steps);
    }
  }
  return steps;
}

/** The ids of every Background step of a feature, its Rules' included. */
function backgroundIdsOf(feature: CucumberFeature): Set<string> {
  const ids = new Set<string>();
  for (const child of feature.children) {
    for (const step of child.background?.steps ?? []) ids.add(step.id);
    for (const ruleChild of child.rule?.children ?? []) {
      for (const step of ruleChild.background?.steps ?? []) ids.add(step.id);
    }
  }
  return ids;
}

interface LocatedScenario {
  scenario: CucumberScenario;
  rule?: CucumberRule | undefined;
}

/** The scenario with an id, at the top of the feature or under a Rule. */
function locate(feature: CucumberFeature, id: string): LocatedScenario | undefined {
  for (const child of feature.children) {
    if (child.scenario?.id === id) return { scenario: child.scenario };
    for (const ruleChild of child.rule?.children ?? []) {
      if (ruleChild.scenario?.id === id) return { scenario: ruleChild.scenario, rule: child.rule };
    }
  }
  return undefined;
}

/** The Examples values of an outline row, by the header's names; none for a plain scenario. */
function parametersOf(
  scenario: CucumberScenario,
  rowId: string | undefined,
): Record<string, string> | undefined {
  for (const examples of scenario.examples) {
    const row = examples.tableBody.find((candidate) => candidate.id === rowId);
    if (row === undefined) continue;
    const header = examples.tableHeader?.cells.map((cell) => cell.value) ?? [];
    if (header.length === 0) return undefined;
    return Object.fromEntries(header.map((name, index) => [name, row.cells[index]?.value ?? '']));
  }
  return undefined;
}

/** The case ids of the scenario's own `@probara:<ID>` tags, once each; the others are problems. */
function caseIdsOf(scenario: CucumberScenario, problems: string[]): string[] {
  const ids: string[] = [];
  for (const tag of scenario.tags) {
    const name = tag.name.replace(/^@/, '');
    if (!name.startsWith(PROBARA_TAG)) continue;
    const id = name.slice(PROBARA_TAG.length).trim();
    if (parseCaseDisplayId(id) === undefined) {
      problems.push(
        `ignored the @probara tag "${tag.name}": it is not a case display ID such as SHOP-12`,
      );
    } else if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

/** A step of the test case as the result sends it, with what its statuses and durations add up to. */
interface ConvertedStep {
  step: TestStepInput;
  status: ResultStatus;
  error?: string | undefined;
  nanoseconds: number;
  background: boolean;
}

/**
 * One attempt as a result. Every attempt is a result of its own, retries included. The steps are the
 * Gherkin steps of the scenario, Background ones nested under one `Background` step; the hooks are not
 * steps, but a failed hook fails the scenario, with its message or `The hook failed`.
 */
export function toAttempt(attempt: CucumberAttempt, context: AttemptContext): Attempt {
  const problems: string[] = [];
  const { gherkinDocument, pickle } = attempt;
  const feature = gherkinDocument.feature;
  const uri = gherkinDocument.uri ?? pickle.uri;
  const path = pathOf(uri, context);
  if (feature === undefined) {
    problems.push(`${uri}: skipped a scenario of a file that has no Feature`);
    return { problems };
  }
  const featureName = feature.name.trim();
  if (path === undefined) {
    problems.push(
      `skipped the feature "${featureName}": its uri is not a file under the root directory`,
    );
    return { problems };
  }
  const located = locate(feature, pickle.astNodeIds[0] ?? '');
  if (located === undefined) {
    problems.push(`${path}: skipped a scenario that is not in its feature`);
    return { problems };
  }
  const { scenario, rule } = located;
  const name = scenario.name.trim();
  if (name === '') {
    problems.push(`${path}: skipped a scenario without a name`);
    return { problems };
  }
  if (featureName === '') {
    problems.push(`${path}: skipped a scenario of a feature without a name`);
    return { problems };
  }

  const steps = stepsOf(feature);
  const backgroundIds = backgroundIdsOf(feature);
  const pickleSteps = new Map(pickle.steps.map((step) => [step.id, step]));
  const converted: ConvertedStep[] = [];
  const hookErrors: string[] = [];
  let hookNanoseconds = 0;
  const resultAttachments: AttachmentInput[] = [];

  for (const testStep of attempt.testCase.testSteps) {
    const result: CucumberStepResult = attempt.stepResults[testStep.id] ?? {
      status: 'UNKNOWN',
      duration: { seconds: 0, nanos: 0 },
    };
    const attachments = attempt.stepAttachments[testStep.id] ?? [];
    if (testStep.pickleStepId === undefined) {
      hookNanoseconds += nanosecondsOf(result.duration);
      resultAttachments.push(...attachments.map(fileOf));
      if (cucumberStepStatus(result.status) === 'failed') {
        hookErrors.push(errorOf(result, 'failed') ?? HOOK_FAILED);
      }
      continue;
    }
    const pickleStep = pickleSteps.get(testStep.pickleStepId);
    if (pickleStep === undefined) continue;
    const gherkinId = pickleStep.astNodeIds[0] ?? '';
    const keyword = steps.get(gherkinId)?.keyword.trim() ?? '';
    const status = cucumberStepStatus(result.status);
    const error = errorOf(result, status);
    const data = dataOf(pickleStep.argument);
    const nanoseconds = nanosecondsOf(result.duration);
    converted.push({
      step: {
        action: pickleStep.text.trim(),
        status,
        durationMs: millisecondsOf(nanoseconds),
        ...(isStepKeyword(keyword) ? { keyword } : {}),
        ...(error === undefined ? {} : { error }),
        ...(data === undefined ? {} : { data }),
        ...(attachments.length === 0 ? {} : { attachments: attachments.map(fileOf) }),
      },
      status,
      error,
      nanoseconds,
      background: backgroundIds.has(gherkinId),
    });
  }

  const background = converted.filter((step) => step.background);
  const own = converted.filter((step) => !step.background);
  const sent: TestStepInput[] = [];
  if (background.length > 0) {
    sent.push({
      action: 'Background',
      status: scenarioStatus(background.map((step) => step.status)),
      durationMs: millisecondsOf(background.reduce((sum, step) => sum + step.nanoseconds, 0)),
      steps: background.map((step) => step.step),
    });
  }
  sent.push(...own.map((step) => step.step));

  const failedSteps = [...background, ...own].flatMap((step) =>
    step.status === 'failed' && step.error !== undefined ? [step.error] : [],
  );
  const errors = [...failedSteps, ...hookErrors];
  const status = scenarioStatus([
    ...converted.map((step) => step.status),
    ...hookErrors.map((): ResultStatus => 'failed'),
  ]);
  const nanoseconds = converted.reduce((sum, step) => sum + step.nanoseconds, 0) + hookNanoseconds;

  const caseIds = caseIdsOf(scenario, problems);
  const [onlyCaseId] = caseIds;
  const parameters = parametersOf(scenario, pickle.astNodeIds[1]);
  const ruleName = rule?.name.trim() ?? '';
  return {
    input: {
      identity: { file: path, titlePath: [featureName, name] },
      status,
      title: name,
      suitePath: [
        ...path.split('/').slice(0, -1),
        featureName,
        ...(ruleName === '' ? [] : [ruleName]),
      ],
      durationMs: millisecondsOf(nanoseconds),
      ...(context.startedAt === undefined ? {} : { startedAt: context.startedAt }),
      ...(parameters === undefined ? {} : { parameters }),
      ...(caseIds.length === 1 && onlyCaseId !== undefined ? { caseDisplayId: onlyCaseId } : {}),
      ...(caseIds.length > 1 ? { caseDisplayIds: caseIds } : {}),
      ...(errors.length === 0 ? {} : { error: errors }),
      ...(resultAttachments.length === 0 ? {} : { attachments: resultAttachments }),
      ...(sent.length === 0 ? {} : { steps: sent }),
    },
    problems,
  };
}
