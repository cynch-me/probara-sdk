/**
 * `probara.*`: what a test tells the reporter about itself, from its body, a hook or a fixture.
 * Every helper applies to the running attempt only, and never throws into the test: a wrong
 * argument, or a call while no test runs, is a warning on the test's stderr.
 */
import { test, type TestInfo } from '@playwright/test';
import {
  CASE_ANNOTATION,
  METADATA_CONTENT_TYPE,
  METADATA_NAME,
  stepTitle,
  type MetadataMessage,
} from './metadata.js';

/** A file for `probara.attach()`: a file on disk, or content in memory. */
export type ProbaraAttachment =
  | { name: string; path: string; contentType?: string }
  | { name: string; body: string | Uint8Array; contentType: string };

/** Values of `probara.parameters()` and `probara.fields()`; numbers and booleans become strings. */
export type ProbaraValues = Record<string, string | number | boolean>;

/** The helpers; each synchronous one returns them, so calls chain. */
export interface Probara {
  /** Links the test to existing cases (`'PRB-12'`, `['PRB-12', 'PRB-13']`), with its other ids. */
  id(ids: string | readonly string[]): Probara;
  /** The title of the case the report creates. Never changes the automation key. */
  title(title: string): Probara;
  /** The suite path of the case the report creates (`'Payments'`, `['Payments', 'Cards']`). */
  suite(path: string | readonly string[]): Probara;
  /** A comment, written first in the notes of the result, before the error. */
  comment(comment: string): Probara;
  /** Leaves this attempt out: it is not reported. */
  ignore(): Probara;
  /** Parameters shown with the result, merged by name. Never part of the automation key. */
  parameters(parameters: ProbaraValues): Probara;
  /** Tags of the case the report creates, accumulated. */
  tags(...tags: string[]): Probara;
  /**
   * Fields of the case the report creates (`description`, `severity`, `priority`, `type`, `layer`,
   * `behavior`, `preconditions`, `postconditions`, or a custom field name), merged by name.
   */
  fields(fields: ProbaraValues): Probara;
  /** Attaches a file or a body to the attempt (to the running `test.step`, if any). */
  attach(attachment: ProbaraAttachment): Promise<void>;
  /**
   * A `test.step` title that declares a step of the case the report creates:
   * `await test.step(probara.step('Pay', 'The order is paid', 'card=visa'), async () => {...})`.
   */
  step(action: string, expected?: string, data?: string): string;
}

type Warn = (message: string) => void;

function isValues(value: unknown): value is ProbaraValues {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => ['string', 'number', 'boolean'].includes(typeof item))
  );
}

function stringsOf(values: ProbaraValues): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, String(value)]));
}

/**
 * A body Playwright can carry from the worker: it serializes one with `body.toString('base64')`,
 * which only a Buffer honours (a plain Uint8Array would arrive as its comma-separated numbers).
 */
function bodyOf(body: string | Uint8Array): string | Buffer {
  if (typeof body === 'string' || Buffer.isBuffer(body)) return body;
  return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** The helpers, bound to `testInfo()` (the running attempt), warning through `warn`. */
export function createProbara(testInfo: () => TestInfo, warn: Warn): Probara {
  /** The steps each attempt declared so far, to number the next one. */
  const declaredSteps = new WeakMap<TestInfo, number>();

  function current(helper: string): TestInfo | undefined {
    try {
      return testInfo();
    } catch {
      warn(`probara.${helper}() only works while a test runs (in a test, a hook or a fixture)`);
      return undefined;
    }
  }

  /** The non-blank items of `items`, with a warning when some are blank. */
  function nonBlank(items: readonly string[], helper: string, what: string): string[] {
    const kept = items.filter((item) => item.trim() !== '');
    if (kept.length < items.length) warn(`probara.${helper}() ignores blank ${what}`);
    return kept;
  }

  /** Hands one message to the reporter; `push` adds no step to Playwright's reports. */
  function send(helper: string, message: MetadataMessage): TestInfo | undefined {
    const info = current(helper);
    info?.attachments.push({
      name: METADATA_NAME,
      contentType: METADATA_CONTENT_TYPE,
      body: Buffer.from(JSON.stringify(message)),
    });
    return info;
  }

  const probara: Probara = {
    id(ids) {
      const list = typeof ids === 'string' ? [ids] : ids;
      if (!isStringList(list)) {
        warn('probara.id() takes a case id or a list of case ids, such as PRB-12');
      } else {
        const description = list.map((id) => id.trim()).join(', ');
        current('id')?.annotations.push({ type: CASE_ANNOTATION, description });
      }
      return probara;
    },
    title(title) {
      if (typeof title !== 'string') warn('probara.title() takes a string');
      else send('title', { type: 'title', value: title });
      return probara;
    },
    suite(path) {
      const levels = typeof path === 'string' ? [path] : path;
      if (!isStringList(levels)) {
        warn('probara.suite() takes a suite title or a list of suite titles');
      } else {
        send('suite', { type: 'suite', value: nonBlank(levels, 'suite', 'suite titles') });
      }
      return probara;
    },
    comment(comment) {
      if (typeof comment !== 'string') warn('probara.comment() takes a string');
      else send('comment', { type: 'comment', value: comment });
      return probara;
    },
    ignore() {
      send('ignore', { type: 'ignore' });
      return probara;
    },
    parameters(parameters) {
      if (!isValues(parameters)) {
        warn('probara.parameters() takes an object of strings, numbers or booleans');
      } else {
        send('parameters', { type: 'parameters', value: stringsOf(parameters) });
      }
      return probara;
    },
    tags(...tags) {
      if (!isStringList(tags)) warn('probara.tags() takes strings');
      else send('tags', { type: 'tags', value: nonBlank(tags, 'tags', 'tags') });
      return probara;
    },
    fields(fields) {
      if (!isValues(fields)) {
        warn('probara.fields() takes an object of strings, numbers or booleans');
      } else {
        send('fields', { type: 'fields', value: stringsOf(fields) });
      }
      return probara;
    },
    async attach(attachment) {
      const info = current('attach');
      if (info === undefined) return;
      const { name } = attachment;
      try {
        await info.attach(
          name,
          'path' in attachment
            ? {
                path: attachment.path,
                ...(attachment.contentType === undefined
                  ? {}
                  : { contentType: attachment.contentType }),
              }
            : { body: bodyOf(attachment.body), contentType: attachment.contentType },
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        warn(`probara.attach() could not attach "${name}": ${reason}`);
      }
    },
    step(action, expected, data) {
      const optional = (value: unknown) => value === undefined || typeof value === 'string';
      const wrong =
        typeof action !== 'string'
          ? 'an action (a string)'
          : !optional(expected)
            ? 'the expected result as a string'
            : !optional(data)
              ? 'the data as a string'
              : undefined;
      if (wrong !== undefined) {
        warn(`probara.step() takes ${wrong}`);
        const untyped: unknown = action;
        return typeof untyped === 'string' ? untyped : String(untyped);
      }
      const info = current('step');
      if (info === undefined) return action;
      const ref = (declaredSteps.get(info) ?? 0) + 1;
      declaredSteps.set(info, ref);
      send('step', {
        type: 'step',
        value: {
          ref,
          action,
          ...(expected === undefined ? {} : { expected }),
          ...(data === undefined ? {} : { data }),
        },
      });
      return stepTitle(action, ref);
    },
  };
  return probara;
}

/**
 * The helpers of the running Playwright test:
 * `import { probara } from '@probara/playwright-reporter'`.
 */
export const probara: Probara = createProbara(
  () => test.info(),
  (message) => {
    console.warn(`[probara] ${message}`);
  },
);
