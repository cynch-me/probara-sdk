/**
 * What a test tells its adapter about itself through the `probara.*` helpers, and how those calls
 * merge. Each call is one {@link MetadataMessage}; an adapter carries the messages from the test to
 * the reporter however its framework allows (Playwright attachments, files of a Jest worker), then
 * merges the messages of one attempt with {@link readMetadataMessages}. Nothing here needs Node.
 */
import { parseCaseIdList } from './case-ids.js';

/**
 * The annotation (Playwright) or JUnit property that links a test to cases:
 * `{ type: 'probara_case', description: 'PRB-12' }`, `<property name="probara_case" value="PRB-12"/>`.
 */
export const CASE_ANNOTATION = 'probara_case';

/** A step of a case the report creates, declared with `probara.step()`. */
export interface CaseStep {
  action: string;
  expected?: string;
  data?: string;
}

/** One helper call, as an adapter carries it (as JSON) from the test to the reporter. */
export type MetadataMessage =
  | { type: 'id'; value: string[] }
  | { type: 'title'; value: string }
  | { type: 'suite'; value: string[] }
  | { type: 'comment'; value: string }
  | { type: 'ignore' }
  | { type: 'parameters'; value: Record<string, string> }
  | { type: 'tags'; value: string[] }
  | { type: 'fields'; value: Record<string, string> }
  | { type: 'step'; value: CaseStep & { ref: number } };

/** What the helpers of one attempt said, merged in call order. */
export interface AttemptMetadata {
  /** `probara.id()`: the linked cases, accumulated, once each, in the order of their first call. */
  ids: string[];
  /** `probara.title()`: the last call wins. */
  title?: string;
  /** `probara.suite()`: the last call wins. */
  suitePath?: string[];
  /** `probara.comment()`: the last call wins. */
  comment?: string;
  /** `probara.ignore()`: the attempt is not reported. */
  ignored: boolean;
  /** `probara.parameters()`: merged by name, the last value wins. */
  parameters: Record<string, string>;
  /** `probara.tags()`: accumulated, once each, in the order of their first call. */
  tags: string[];
  /** `probara.fields()`: merged by name, the last value wins. */
  fields: Record<string, string>;
  /** `probara.step()` declarations, by the reference the adapter gave each. */
  steps: Map<number, CaseStep>;
}

/** The metadata of an attempt no helper spoke about. */
export function emptyMetadata(): AttemptMetadata {
  return {
    ids: [],
    ignored: false,
    parameters: Object.create(null) as Record<string, string>,
    tags: [],
    fields: Object.create(null) as Record<string, string>,
    steps: new Map(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** A list of strings, trimmed, without its blank items; `undefined` when it is not one. */
function texts(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return undefined;
  return value.map((item) => item.trim()).filter((item) => item !== '');
}

/** A record of non-blank names to strings (values trimmed, blank ones kept as `''`). */
function textRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const record = Object.create(null) as Record<string, string>;
  for (const [name, item] of Object.entries(value)) {
    const key = text(name);
    // `__proto__` would be an own key here, but a trap for whoever copies the record later.
    if (key === undefined || key === '__proto__' || typeof item !== 'string') return undefined;
    record[key] = item.trim();
  }
  return record;
}

function addOnce(list: string[], items: readonly string[]): void {
  for (const item of items) if (!list.includes(item)) list.push(item);
}

/**
 * Merges one message (as parsed from its JSON) into `metadata`: `false`, and no change, when it is
 * malformed (not an object, an unknown type, a value of the wrong shape). An adapter with messages of
 * its own handles those first and hands the others here.
 */
export function applyMetadataMessage(metadata: AttemptMetadata, message: unknown): boolean {
  if (!isRecord(message)) return false;
  const { type, value } = message;
  switch (type) {
    case 'id': {
      const lists = texts(value);
      if (lists === undefined) return false;
      addOnce(metadata.ids, lists.flatMap(parseCaseIdList));
      return true;
    }
    case 'title':
    case 'comment': {
      const given = text(value);
      if (given === undefined) return typeof value === 'string';
      if (type === 'title') metadata.title = given;
      else metadata.comment = given;
      return true;
    }
    case 'suite': {
      const levels = texts(value);
      if (levels === undefined) return false;
      if (levels.length > 0) metadata.suitePath = levels;
      return true;
    }
    case 'ignore':
      metadata.ignored = true;
      return true;
    case 'tags': {
      const tags = texts(value);
      if (tags === undefined) return false;
      addOnce(metadata.tags, tags);
      return true;
    }
    case 'parameters':
    case 'fields': {
      const record = textRecord(value);
      if (record === undefined) return false;
      Object.assign(type === 'parameters' ? metadata.parameters : metadata.fields, record);
      return true;
    }
    case 'step': {
      if (!isRecord(value) || typeof value.ref !== 'number') return false;
      const action = text(value.action);
      const expected = value.expected === undefined ? undefined : text(value.expected);
      const data = value.data === undefined ? undefined : text(value.data);
      if (action === undefined || !Number.isInteger(value.ref) || value.ref < 1) return false;
      metadata.steps.set(value.ref, {
        action,
        ...(expected === undefined ? {} : { expected }),
        ...(data === undefined ? {} : { data }),
      });
      return true;
    }
    default:
      return false;
  }
}

/**
 * The metadata of one attempt from its messages, in call order, and one problem per message left
 * out (`Ignored malformed probara metadata (type "title")`). Pass `undefined` for a message that
 * could not be parsed. Never throws.
 */
export function readMetadataMessages(messages: readonly unknown[]): {
  metadata: AttemptMetadata;
  problems: string[];
} {
  const metadata = emptyMetadata();
  const problems: string[] = [];
  for (const message of messages) {
    if (applyMetadataMessage(metadata, message)) continue;
    const type = isRecord(message) && typeof message.type === 'string' ? message.type : '?';
    problems.push(`Ignored malformed probara metadata (type ${JSON.stringify(type)})`);
  }
  return { metadata, problems };
}
