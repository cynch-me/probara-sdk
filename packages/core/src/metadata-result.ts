/**
 * The parts of a result the `probara.*` metadata of an attempt decides, for every adapter alike: the
 * linked cases, the title and suites of a created case, the comment, the parameters and the case.
 */
import { parseCaseIdList } from './case-ids.js';
import type { AttemptMetadata, CaseStep } from './metadata.js';
import type { TestCaseInput, TestResultInput } from './result.js';

/**
 * The cases an attempt links, each once: the ids of the explicit lists first (`probara_case`
 * annotations or properties, `probara.id()`; each a comma-separated list), then the ids found in its
 * titles.
 */
export function linkedCaseIds(explicit: readonly string[], titleIds: readonly string[]): string[] {
  const ids = [...explicit.flatMap(parseCaseIdList), ...titleIds];
  return ids.filter((id, index) => ids.indexOf(id) === index);
}

/** The field `probara.fields()` takes the description of a created case from, in any case. */
const DESCRIPTION_FIELD = 'description';

/**
 * The case a report creates for the attempt: the tags and fields of `probara.tags()` and
 * `probara.fields()` (its `description` field is the case description), and the case steps the
 * adapter found declared; `undefined` when there is none of them.
 */
export function caseOf(
  metadata: AttemptMetadata,
  caseSteps: readonly CaseStep[],
): TestCaseInput | undefined {
  const fields: Record<string, string> = {};
  let description: string | undefined;
  for (const [name, value] of Object.entries(metadata.fields)) {
    if (name.toLowerCase() === DESCRIPTION_FIELD) description = value;
    else fields[name] = value;
  }
  const created: TestCaseInput = {
    ...(description === undefined || description === '' ? {} : { description }),
    ...(metadata.tags.length === 0 ? {} : { tags: metadata.tags }),
    ...(Object.keys(fields).length === 0 ? {} : { fields }),
    ...(caseSteps.length === 0 ? {} : { steps: [...caseSteps] }),
  };
  return Object.keys(created).length === 0 ? undefined : created;
}

/** The fields of a `TestResultInput` that {@link metadataResultFields} fills. */
export type MetadataResultFields = Pick<
  TestResultInput,
  'caseDisplayId' | 'caseDisplayIds' | 'title' | 'suitePath' | 'comment' | 'parameters' | 'case'
>;

/**
 * The parts of an attempt's result its metadata decides, to spread into the `TestResultInput`: the
 * linked cases (`caseIds`, see {@link linkedCaseIds}) as `caseDisplayId` or `caseDisplayIds`, the
 * title, suite path and comment, the parameters, and the created case ({@link caseOf}). What the
 * metadata does not say is left out.
 */
export function metadataResultFields(
  metadata: AttemptMetadata,
  {
    caseIds = [],
    caseSteps = [],
  }: { caseIds?: readonly string[]; caseSteps?: readonly CaseStep[] } = {},
): MetadataResultFields {
  const created = caseOf(metadata, caseSteps);
  const parameters = { ...metadata.parameters };
  return {
    ...(caseIds.length === 1 ? { caseDisplayId: caseIds[0] } : {}),
    ...(caseIds.length > 1 ? { caseDisplayIds: [...caseIds] } : {}),
    ...(metadata.title === undefined ? {} : { title: metadata.title }),
    ...(metadata.suitePath === undefined ? {} : { suitePath: metadata.suitePath }),
    ...(metadata.comment === undefined ? {} : { comment: metadata.comment }),
    ...(Object.keys(parameters).length === 0 ? {} : { parameters }),
    ...(created === undefined ? {} : { case: created }),
  };
}
