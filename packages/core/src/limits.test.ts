import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as limits from './limits.js';

// Drift guard: every limit the published OpenAPI expresses must match the constant core enforces.
interface Schema {
  type?: string | string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
  maxItems?: number;
  maxLength?: number;
  pattern?: string;
}

const spec = JSON.parse(
  readFileSync(new URL('../openapi/probara-api.json', import.meta.url), 'utf8'),
) as {
  paths: Record<
    string,
    Record<string, { requestBody: { content: Record<string, { schema: Schema }> } }>
  >;
};

const request = spec.paths['/api/v1/projects/{projectId}/reports']?.['post']?.requestBody.content[
  'application/json'
]?.schema as Schema;

function at(schema: Schema | undefined, ...keys: string[]): Schema {
  let current = schema;
  for (const key of keys) current = current?.properties?.[key];
  if (current === undefined) throw new Error(`No schema at ${keys.join('.')}`);
  return current;
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
