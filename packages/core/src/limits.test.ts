import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as limits from './limits.js';

// Drift guard: every limit the published OpenAPI expresses must match the constant core enforces.
interface Schema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
  maxItems?: number;
  maxProperties?: number;
  additionalProperties?: Schema;
  maxLength?: number;
  pattern?: string;
}

interface Operation {
  description: string;
  requestBody: { content: Record<string, { schema: Schema }> };
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
}

const spec = JSON.parse(
  readFileSync(new URL('../openapi/probara-api.json', import.meta.url), 'utf8'),
) as { paths: Record<string, Record<string, Operation>> };

const request = spec.paths['/api/v1/projects/{projectId}/reports']?.['post']?.requestBody.content[
  'application/json'
]?.schema as Schema;

function at(schema: Schema | undefined, ...keys: string[]): Schema {
  let current = schema;
  for (const key of keys) current = current?.properties?.[key];
  if (current === undefined) throw new Error(`No schema at ${keys.join('.')}`);
  return current;
}

const stage = spec.paths['/api/v1/runs/{runUlid}/results/{resultUlid}/attachments:stage']?.[
  'post'
] as Operation;
const commit = spec.paths['/api/v1/runs/{runUlid}/results/{resultUlid}/attachments']?.[
  'patch'
] as Operation;

/** The first number `pattern` captures in `text`: a limit the OpenAPI states in prose only. */
function stated(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  if (match?.[1] === undefined) throw new Error(`${String(pattern)} is not in the description`);
  return Number(match[1]);
}

const results = at(request, 'results');
const entry = results.items;
const [reuseRun, createRun] = at(request, 'run').anyOf ?? [];

describe('contract limits', () => {
  it('match the report results limits of the published OpenAPI', () => {
    expect(limits.MAX_RESULTS_PER_REPORT).toBe(results.maxItems);
    expect(limits.MAX_AUTOMATION_KEY_LENGTH).toBe(at(entry, 'automationKey').maxLength);
    expect(limits.MAX_TITLE_LENGTH).toBe(at(entry, 'title').maxLength);
    expect(limits.MAX_SUITE_PATH_DEPTH).toBe(at(entry, 'suitePath').maxItems);
    expect(limits.MAX_SUITE_SEGMENT_LENGTH).toBe(at(entry, 'suitePath').items?.maxLength);
    expect(limits.MAX_NOTES_LENGTH).toBe(at(entry, 'notes').maxLength);
    expect(limits.MAX_CASE_DISPLAY_ID_LENGTH).toBe(at(entry, 'caseDisplayId').maxLength);
  });

  it('match the run limits of the published OpenAPI', () => {
    expect(limits.MAX_RUN_NAME_LENGTH).toBe(at(createRun, 'name').maxLength);
    expect(limits.MAX_TAGS).toBe(at(createRun, 'tags').maxItems);
    expect(limits.MAX_TAG_LENGTH).toBe(at(createRun, 'tags').items?.maxLength);
    expect(limits.MAX_CONFIGURATION_ULIDS).toBe(at(createRun, 'configurationUlids').maxItems);
  });

  it('match the CI source limits of both run shapes', () => {
    for (const shape of [reuseRun, createRun]) {
      const runSource = at(shape, 'source');
      expect(limits.MAX_BRANCH_LENGTH).toBe(at(runSource, 'branch').maxLength);
      expect(limits.MAX_COMMIT_LENGTH).toBe(at(runSource, 'commit').maxLength);
      expect(limits.COMMIT_PATTERN.source).toBe(at(runSource, 'commit').pattern);
      expect(limits.MAX_BUILD_URL_LENGTH).toBe(at(runSource, 'buildUrl').maxLength);
    }
  });

  it('match the parameters, steps and case limits of a report entry', () => {
    const parameters = at(entry, 'parameters');
    const steps = at(entry, 'steps');
    const step = steps.items;
    const caseInput = at(entry, 'case');
    const caseStep = at(caseInput, 'steps').items;
    expect(limits.MAX_PARAMETERS).toBe(parameters.maxProperties);
    expect(limits.MAX_PARAMETER_VALUE_LENGTH).toBe(parameters.additionalProperties?.maxLength);
    expect(limits.MAX_STEPS_PER_RESULT).toBe(steps.maxItems);
    expect(limits.MAX_STEP_ACTION_LENGTH).toBe(at(step, 'action').maxLength);
    expect(limits.MAX_STEP_TEXT_LENGTH).toBe(at(step, 'expected').maxLength);
    expect(limits.MAX_STEP_TEXT_LENGTH).toBe(at(step, 'data').maxLength);
    expect(limits.MAX_STEP_ERROR_LENGTH).toBe(at(step, 'error').maxLength);
    expect(limits.MAX_CASE_DESCRIPTION_LENGTH).toBe(at(caseInput, 'description').maxLength);
    expect(limits.MAX_CASE_TAGS).toBe(at(caseInput, 'tags').maxItems);
    expect(limits.MAX_CASE_TAG_LENGTH).toBe(at(caseInput, 'tags').items?.maxLength);
    expect(limits.MAX_CASE_FIELDS).toBe(at(caseInput, 'fields').maxProperties);
    expect(limits.MAX_CASE_FIELD_VALUE_LENGTH).toBe(
      at(caseInput, 'fields').additionalProperties?.maxLength,
    );
    expect(limits.MAX_CASE_STEPS).toBe(at(caseInput, 'steps').maxItems);
    expect(limits.MAX_STEP_ACTION_LENGTH).toBe(at(caseStep, 'action').maxLength);
    expect(limits.MAX_STEP_TEXT_LENGTH).toBe(at(caseStep, 'expected').maxLength);
    expect(limits.MAX_STEP_TEXT_LENGTH).toBe(at(caseStep, 'data').maxLength);
    // Stated in the descriptions only.
    expect(limits.MAX_PARAMETER_NAME_LENGTH).toBe(
      stated(parameters.description ?? '', /a name has 1–(\d+) characters/),
    );
    expect(limits.MAX_STEP_DEPTH).toBe(
      stated(steps.description ?? '', /nested at most (\d+) levels deep/),
    );
    expect(limits.MAX_CASE_FIELD_NAME_LENGTH).toBe(
      stated(at(caseInput, 'fields').description ?? '', /1–(\d+) characters once trimmed/),
    );
  });

  it('match the links limits of a report entry', () => {
    const links = at(entry, 'links');
    expect(limits.MAX_LINKS_PER_RESULT).toBe(links.maxItems);
    expect(limits.MAX_LINK_URL_LENGTH).toBe(at(links.items, 'url').maxLength);
    expect(limits.MAX_LINK_NAME_LENGTH).toBe(at(links.items, 'name').maxLength);
  });

  it('match the per-report totals the published OpenAPI states', () => {
    const text = results.description ?? '';
    expect(limits.MAX_RESULT_STEPS_PER_REPORT).toBe(stated(text, /at most (\d+) result steps/));
    expect(limits.MAX_CASE_STEPS_PER_REPORT).toBe(stated(text, /at most (\d+) case steps/));
    expect(limits.MAX_CASE_TAGS_PER_REPORT).toBe(stated(text, /at most (\d+) case tag names/));
  });

  it('match the run references by name of the published OpenAPI', () => {
    expect(limits.MAX_RUN_DESCRIPTION_LENGTH).toBe(at(createRun, 'description').maxLength);
    expect(limits.MAX_ENVIRONMENT_NAME_LENGTH).toBe(at(createRun, 'environment').maxLength);
    expect(limits.MAX_MILESTONE_REFERENCE_LENGTH).toBe(at(createRun, 'milestone').maxLength);
    expect(limits.MAX_PLAN_REFERENCE_LENGTH).toBe(at(createRun, 'plan').maxLength);
    const configurations = at(createRun, 'configurations');
    expect(limits.MAX_CONFIGURATIONS).toBe(configurations.maxItems);
    expect(limits.MAX_CONFIGURATION_NAME_LENGTH).toBe(at(configurations.items, 'group').maxLength);
    expect(limits.MAX_CONFIGURATION_NAME_LENGTH).toBe(at(configurations.items, 'name').maxLength);
  });

  it('match every ULID pattern of the published OpenAPI', () => {
    const ulidPatterns = [
      at(reuseRun, 'ulid').pattern,
      at(createRun, 'environmentId').pattern,
      at(createRun, 'milestoneId').pattern,
      at(createRun, 'configurationUlids').items?.pattern,
      at(request, 'options', 'suiteUlid').pattern,
    ];
    for (const pattern of ulidPatterns) expect(limits.ULID_PATTERN.source).toBe(pattern);
  });

  it('match the result attachment limits of the published OpenAPI', () => {
    const files = at(stage.requestBody.content['multipart/form-data']?.schema, 'file');
    const staged = at(
      stage.responses['200']?.content?.['application/json']?.schema,
      'attachments',
    ).items;
    const committed = at(commit.requestBody.content['application/json']?.schema, 'attachments');

    expect(limits.MAX_ATTACHMENTS_PER_STAGE_REQUEST).toBe(files.maxItems);
    expect(limits.MAX_ATTACHMENT_FILENAME_LENGTH).toBe(at(staged, 'originalFilename').maxLength);
    expect(limits.MAX_ATTACHMENT_FILENAME_LENGTH).toBe(
      at(committed.items, 'originalFilename').maxLength,
    );
    // Stated in the operation descriptions only.
    expect(limits.MAX_ATTACHMENT_BYTES).toBe(
      stated(stage.description, /Every other file is stored as sent, up to (\d+) MiB/) *
        1024 *
        1024,
    );
    expect(limits.MAX_IMAGE_ATTACHMENT_BYTES).toBe(
      stated(stage.description, /limited to (\d+) MiB and \d+ px per side/) * 1024 * 1024,
    );
    expect(limits.MAX_IMAGE_ATTACHMENT_DIMENSION).toBe(
      stated(stage.description, /limited to \d+ MiB and (\d+) px per side/),
    );
    expect(limits.MAX_ATTACHMENTS_PER_RESULT).toBe(
      stated(commit.description, /holds at most (\d+) attachments/),
    );
    const denied = /except executables and scripts \(([^)]*)\)/.exec(stage.description)?.[1];
    expect([...limits.DENIED_ATTACHMENT_CONTENT_TYPES].sort()).toEqual(
      [...(denied ?? '').matchAll(/`([^`]+)`/g)].map((match) => match[1]).sort(),
    );
  });

  it('keep one stage request well under the request body limit of the server', () => {
    // 20 files of 32 MiB exceed the 100 MB a Cloudflare Workers request may carry.
    expect(limits.MAX_STAGE_REQUEST_BYTES).toBeLessThan(100_000_000);
    expect(limits.MAX_STAGE_REQUEST_BYTES).toBeGreaterThanOrEqual(limits.MAX_ATTACHMENT_BYTES);
  });

  it('accept and reject values the way the server does', () => {
    expect(limits.ULID_PATTERN.test('01J9Z3K4M5N6P7Q8R9S0T1V2W3')).toBe(true);
    expect(limits.ULID_PATTERN.test('01J9Z3K4M5N6P7Q8R9S0T1V2WI')).toBe(false);
    expect(limits.COMMIT_PATTERN.test('9fceb02d0ae598e95dc970b74767f19372d61af8')).toBe(true);
    expect(limits.COMMIT_PATTERN.test('abc def')).toBe(false);
    expect(limits.IDEMPOTENCY_KEY_PATTERN.test('a'.repeat(255))).toBe(true);
    expect(limits.IDEMPOTENCY_KEY_PATTERN.test('a'.repeat(256))).toBe(false);
    expect(limits.IDEMPOTENCY_KEY_PATTERN.test('key with space')).toBe(false);
  });
});
