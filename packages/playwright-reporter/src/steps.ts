/**
 * The steps of one Playwright attempt as the step tree of a `@probara/core` result, like Qase's
 * reporter reads them: `test.step` steps and the hooks that ran some, nested as they ran.
 */
import type { TestStep } from '@playwright/test/reporter';
import type { AttachmentInput, TestError, TestStepInput } from '@probara/core';
import { isMetadataAttachment, parseStepTitle, type CaseStep } from './metadata.js';

type StepAttachment = TestStep['attachments'][number];

/** The steps of an attempt, the files they took, and the case steps they declared. */
export interface StepTranslation {
  steps: TestStepInput[];
  /**
   * The attachments of the attempt that belong to a step (the same objects as in the attempt's
   * `attachments`): not to be sent with the result as well.
   */
  claimed: Set<object>;
  /**
   * The `probara.step()` declarations whose step ran and is not inside another declared step, in
   * the order they started: the steps of the case a report creates.
   */
  caseSteps: CaseStep[];
}

/** A category of the steps a test author wrote. */
const USER_STEP = 'test.step';
const HOOK = 'hook';

interface Visit {
  steps: TestStepInput[];
  /** Files of dropped steps that no `test.step` above them took yet. */
  loose: StepAttachment[];
}

function errorOf(step: TestStep): TestError | undefined {
  const { error } = step;
  if (error === undefined) return undefined;
  const message = error.message ?? error.value;
  return {
    ...(message === undefined ? {} : { message }),
    ...(error.stack === undefined ? {} : { stack: error.stack }),
  };
}

/**
 * Failed when it threw, skipped for `test.step.skip()` (a `skip` annotation, since Playwright
 * 1.50), passed otherwise.
 */
function statusOf(step: TestStep): TestStepInput['status'] {
  if (step.error !== undefined) return 'failed';
  const annotations = (step as { annotations?: TestStep['annotations'] }).annotations;
  return annotations?.some((annotation) => annotation.type === 'skip') === true
    ? 'skipped'
    : 'passed';
}

/** The files attached to the step itself; none before Playwright 1.50, which does not say. */
function ownAttachments(step: TestStep): StepAttachment[] {
  const attachments = (step as { attachments?: StepAttachment[] }).attachments;
  return Array.isArray(attachments) ? attachments : [];
}

/**
 * Translates the steps of an attempt. Kept: every `test.step`, and each hook (`Before Hooks`,
 * `beforeEach hook`...) that holds one; dropped: `expect`, Playwright API calls, fixtures,
 * attachment steps and hooks without a `test.step`, whose `test.step` children move up to the
 * nearest kept step. A step fails when it threw and is skipped for `test.step.skip()`.
 *
 * A `probara.step()` title loses its marker, and takes the expected result and data of its
 * declaration. Each `test.step` takes the files attached while it ran (`probara.attach()`,
 * `testInfo.attach()`), through `toFile`, when Playwright reports them per step (1.50 and later);
 * the others stay with the attempt.
 */
export function translateSteps(
  steps: readonly TestStep[],
  declared: ReadonlyMap<number, CaseStep>,
  toFile: (attachment: StepAttachment) => AttachmentInput,
): StepTranslation {
  const claimed = new Set<object>();

  const visitAll = (list: readonly TestStep[]): Visit => {
    const visits = list.map(visit);
    return {
      steps: visits.flatMap((each) => each.steps),
      loose: visits.flatMap((each) => each.loose),
    };
  };

  const visit = (step: TestStep): Visit => {
    const own = ownAttachments(step);
    if (step.category !== USER_STEP) {
      const children = visitAll(step.steps);
      const loose = [...own, ...children.loose];
      if (step.category !== HOOK || children.steps.length === 0) {
        return { steps: children.steps, loose };
      }
      return { steps: [node(step, step.title, undefined, children.steps, [])], loose };
    }
    for (const attachment of own) claimed.add(attachment);
    const children = visitAll(step.steps);
    for (const attachment of children.loose) claimed.add(attachment);
    const parsed = parseStepTitle(step.title);
    const declaration = parsed === undefined ? undefined : declared.get(parsed.ref);
    const files = [...own, ...children.loose].filter(
      (attachment) => !isMetadataAttachment(attachment),
    );
    return {
      steps: [node(step, parsed?.action ?? step.title, declaration, children.steps, files)],
      loose: [],
    };
  };

  const node = (
    step: TestStep,
    action: string,
    declaration: CaseStep | undefined,
    children: TestStepInput[],
    files: StepAttachment[],
  ): TestStepInput => {
    const error = errorOf(step);
    return {
      action,
      status: statusOf(step),
      durationMs: step.duration,
      ...(error === undefined ? {} : { error }),
      ...(declaration?.expected === undefined ? {} : { expected: declaration.expected }),
      ...(declaration?.data === undefined ? {} : { data: declaration.data }),
      ...(children.length === 0 ? {} : { steps: children }),
      ...(files.length === 0 ? {} : { attachments: files.map(toFile) }),
    };
  };

  const caseSteps: CaseStep[] = [];
  const collect = (list: readonly TestStep[]): void => {
    for (const step of list) {
      const parsed = step.category === USER_STEP ? parseStepTitle(step.title) : undefined;
      const declaration = parsed === undefined ? undefined : declared.get(parsed.ref);
      if (declaration === undefined) collect(step.steps);
      else caseSteps.push(declaration);
    }
  };
  collect(steps);

  return { steps: visitAll(steps).steps, claimed, caseSteps };
}
