/**
 * The argument checks of the `probara.*` helpers, for every adapter alike: a call becomes one
 * well-formed {@link MetadataMessage} handed to the adapter's sink, and a wrong argument becomes a
 * warning. Nothing throws into the test. Nothing here needs Node.
 */
import { MAX_LINK_URL_LENGTH } from './limits.js';
import { httpUrlOf } from './links.js';
import type { CaseStep, MetadataMessage } from './metadata.js';

/** Values of `probara.parameters()` and `probara.fields()`; numbers and booleans become strings. */
export type MetadataValues = Record<string, string | number | boolean>;

/** Where the recorder hands each message: the adapter's transport to its reporter. */
export type MetadataSink = (message: MetadataMessage) => void;

/** The helpers every adapter shares, checked; a binding adds its own (`attach`, `step`) around them. */
export interface MetadataRecorder {
  /** `probara.id('PRB-12')`, `probara.id(['PRB-12', 'PRB-13'])`: an `id` message, ids trimmed. */
  id(ids: string | readonly string[]): void;
  /** `probara.title()`: a `title` message. */
  title(title: string): void;
  /** `probara.suite('Payments')`, `probara.suite(['Payments', 'Cards'])`: a `suite` message. */
  suite(path: string | readonly string[]): void;
  /** `probara.comment()`: a `comment` message. */
  comment(comment: string): void;
  /** `probara.ignore()`: an `ignore` message. */
  ignore(): void;
  /** `probara.parameters()`: a `parameters` message, values as strings. */
  parameters(parameters: MetadataValues): void;
  /** `probara.tags()`: a `tags` message. */
  tags(...tags: string[]): void;
  /** `probara.fields()`: a `fields` message, values as strings. */
  fields(fields: MetadataValues): void;
  /**
   * `probara.link('https://ci.example.com/build/12', 'Build')`: a `link` message, the URL and the
   * name trimmed. Only an absolute `http(s)` URL of at most 2048 characters is sent.
   */
  link(url: string, name?: string): void;
  /** `probara.issue('PRB-7')`: an `issue` message; the reporter links it with `issueUrlTemplate`. */
  issue(id: string): void;
  /**
   * Checks the parts of a case step `probara.step()` declares: the declaration as given, or
   * `undefined` after a warning naming the wrong part. Sends nothing: the adapter gives each step of
   * an attempt its reference and sends the `step` message itself.
   */
  caseStep(action: unknown, expected?: unknown, data?: unknown): CaseStep | undefined;
}

function isValues(value: unknown): value is MetadataValues {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => ['string', 'number', 'boolean'].includes(typeof item))
  );
}

function stringsOf(values: MetadataValues): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, String(value)]));
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

/**
 * The `probara.*` helpers every adapter shares: each call is checked, then handed to `sink` as one
 * message; a wrong argument, or a sink that throws, is a warning through `warn` instead.
 */
export function createMetadataRecorder(
  sink: MetadataSink,
  warn: (message: string) => void,
): MetadataRecorder {
  function send(message: MetadataMessage): void {
    try {
      sink(message);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      warn(`probara.${message.type}() could not be recorded: ${reason}`);
    }
  }

  /** The non-blank items of `items`, with a warning when some are blank. */
  function nonBlank(items: readonly string[], helper: string, what: string): string[] {
    const kept = items.filter((item) => item.trim() !== '');
    if (kept.length < items.length) warn(`probara.${helper}() ignores blank ${what}`);
    return kept;
  }

  return {
    id(ids) {
      const list = typeof ids === 'string' ? [ids] : ids;
      if (!isStringList(list))
        warn('probara.id() takes a case id or a list of case ids, such as PRB-12');
      else send({ type: 'id', value: list.map((id) => id.trim()) });
    },
    title(title) {
      if (typeof title !== 'string') warn('probara.title() takes a string');
      else send({ type: 'title', value: title });
    },
    suite(path) {
      const levels = typeof path === 'string' ? [path] : path;
      if (!isStringList(levels))
        warn('probara.suite() takes a suite title or a list of suite titles');
      else send({ type: 'suite', value: nonBlank(levels, 'suite', 'suite titles') });
    },
    comment(comment) {
      if (typeof comment !== 'string') warn('probara.comment() takes a string');
      else send({ type: 'comment', value: comment });
    },
    ignore() {
      send({ type: 'ignore' });
    },
    parameters(parameters) {
      if (!isValues(parameters)) {
        warn('probara.parameters() takes an object of strings, numbers or booleans');
      } else {
        send({ type: 'parameters', value: stringsOf(parameters) });
      }
    },
    tags(...tags) {
      if (!isStringList(tags)) warn('probara.tags() takes strings');
      else send({ type: 'tags', value: nonBlank(tags, 'tags', 'tags') });
    },
    fields(fields) {
      if (!isValues(fields)) {
        warn('probara.fields() takes an object of strings, numbers or booleans');
      } else {
        send({ type: 'fields', value: stringsOf(fields) });
      }
    },
    link(url, name) {
      const checked = httpUrlOf(url);
      if (checked === undefined) {
        warn(
          `probara.link() takes an absolute http(s) URL of at most ${MAX_LINK_URL_LENGTH} characters`,
        );
      } else if (!isOptionalString(name)) {
        warn('probara.link() takes the name as a string');
      } else {
        const label = name?.trim() ?? '';
        send({
          type: 'link',
          value: label === '' ? { url: checked } : { url: checked, name: label },
        });
      }
    },
    issue(id) {
      if (typeof id !== 'string' || id.trim() === '') {
        warn('probara.issue() takes an issue id (a string), such as PRB-7');
      } else send({ type: 'issue', value: { id: id.trim() } });
    },
    caseStep(action, expected, data) {
      if (typeof action !== 'string') {
        warn('probara.step() takes an action (a string)');
        return undefined;
      }
      const wrong = !isOptionalString(expected)
        ? 'the expected result as a string'
        : !isOptionalString(data)
          ? 'the data as a string'
          : undefined;
      if (wrong !== undefined) {
        warn(`probara.step() takes ${wrong}`);
        return undefined;
      }
      return {
        action,
        ...(typeof expected === 'string' ? { expected } : {}),
        ...(typeof data === 'string' ? { data } : {}),
      };
    },
  };
}
