/**
 * How the `probara.*` helpers, which run in Playwright's workers, hand metadata to the reporter,
 * which runs in the main process. Case ids travel as `probara_case` annotations (the JUnit import
 * reads them too). Everything else travels as one small attachment per call, named `_probara` and
 * typed {@link METADATA_CONTENT_TYPE}: attachments belong to one attempt (so every retry carries
 * its own), survive blob reports and `merge-reports`, and are never uploaded to Probara.
 */

/** The annotation that links a test to cases: `{ type: 'probara_case', description: 'PRB-12' }`. */
export const CASE_ANNOTATION = 'probara_case';
/** The name of a metadata attachment; terminal reporters skip names that start with `_`. */
export const METADATA_NAME = '_probara';
export const METADATA_CONTENT_TYPE = 'application/vnd.probara.metadata+json';

/** A step of a case the report creates, declared with `probara.step(action, expected, data)`. */
export interface CaseStep {
  action: string;
  expected?: string;
  data?: string;
}

/** One helper call, as its attachment body holds it (JSON). */
export type MetadataMessage =
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
  /** `probara.step()` declarations, by the reference their step title carries. */
  steps: Map<number, CaseStep>;
}

/** ` [probara:3]`: the end of a step title `probara.step()` made, pointing at its declaration. */
const STEP_MARKER = / \[probara:([1-9]\d{0,8})\]$/;

/** The title `probara.step()` returns for `test.step`: the action and a short reference. */
export function stepTitle(action: string, ref: number): string {
  return `${action} [probara:${ref}]`;
}

/** The action and reference of a step title `probara.step()` made, if it made it. */
export function parseStepTitle(title: string): { action: string; ref: number } | undefined {
  const match = STEP_MARKER.exec(title);
  if (match === null) return undefined;
  return { action: title.slice(0, match.index), ref: Number(match[1]) };
}

export function emptyMetadata(): AttemptMetadata {
  return {
    ignored: false,
    parameters: Object.create(null) as Record<string, string>,
    tags: [],
    fields: Object.create(null) as Record<string, string>,
    steps: new Map(),
  };
}

export function isMetadataAttachment(attachment: { contentType: string }): boolean {
  return attachment.contentType === METADATA_CONTENT_TYPE;
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

/** Merges one message into `metadata`; `false` when it is malformed. */
function apply(metadata: AttemptMetadata, message: unknown): boolean {
  if (!isRecord(message)) return false;
  const { type, value } = message;
  switch (type) {
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
      for (const tag of tags) if (!metadata.tags.includes(tag)) metadata.tags.push(tag);
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

function bodyText(body: Buffer | string | undefined): string | undefined {
  if (body === undefined) return undefined;
  return typeof body === 'string' ? body : body.toString('utf8');
}

/**
 * The metadata the helpers attached to one attempt, in call order, and why any attachment was
 * left out. A malformed one (not JSON, an unknown type, a value of the wrong shape) never throws.
 */
export function readMetadata(
  attachments: readonly { contentType: string; body?: Buffer | string | undefined }[],
): { metadata: AttemptMetadata; problems: string[] } {
  const metadata = emptyMetadata();
  const problems: string[] = [];
  for (const attachment of attachments) {
    if (!isMetadataAttachment(attachment)) continue;
    let message: unknown;
    try {
      message = JSON.parse(bodyText(attachment.body) ?? '');
    } catch {
      message = undefined;
    }
    if (!apply(metadata, message)) {
      const type = isRecord(message) && typeof message.type === 'string' ? message.type : '?';
      problems.push(`Ignored malformed probara metadata (type ${JSON.stringify(type)})`);
    }
  }
  return { metadata, problems };
}
