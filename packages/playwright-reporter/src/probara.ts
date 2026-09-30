/**
 * `probara.*`: what a test tells the reporter about itself, from its body, a hook or a fixture.
 * Every helper applies to the running attempt only, and never throws into the test: a wrong
 * argument, or a call while no test runs, is a warning on the test's stderr.
 */
import { test, type TestInfo } from '@playwright/test';
import { createMetadataRecorder, type MetadataValues } from '@probara/core';
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
export type ProbaraValues = MetadataValues;

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

/**
 * A body Playwright can carry from the worker: it serializes one with `body.toString('base64')`,
 * which only a Buffer honours (a plain Uint8Array would arrive as its comma-separated numbers).
 */
function bodyOf(body: string | Uint8Array): string | Buffer {
  if (typeof body === 'string' || Buffer.isBuffer(body)) return body;
  return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
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

  /** One message as a metadata attachment; `push` adds no step to Playwright's reports. */
  function attachMessage(info: TestInfo, message: MetadataMessage): void {
    info.attachments.push({
      name: METADATA_NAME,
      contentType: METADATA_CONTENT_TYPE,
      body: Buffer.from(JSON.stringify(message)),
    });
  }

  /**
   * Hands one message to the reporter: case ids as a `probara_case` annotation (the JUnit import
   * reads them too), the rest as metadata attachments.
   */
  function send(message: MetadataMessage): void {
    const info = current(message.type);
    if (info === undefined) return;
    if (message.type === 'id') {
      info.annotations.push({ type: CASE_ANNOTATION, description: message.value.join(', ') });
    } else {
      attachMessage(info, message);
    }
  }

  const recorder = createMetadataRecorder(send, warn);

  const probara: Probara = {
    id(ids) {
      recorder.id(ids);
      return probara;
    },
    title(title) {
      recorder.title(title);
      return probara;
    },
    suite(path) {
      recorder.suite(path);
      return probara;
    },
    comment(comment) {
      recorder.comment(comment);
      return probara;
    },
    ignore() {
      recorder.ignore();
      return probara;
    },
    parameters(parameters) {
      recorder.parameters(parameters);
      return probara;
    },
    tags(...tags) {
      recorder.tags(...tags);
      return probara;
    },
    fields(fields) {
      recorder.fields(fields);
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
      const declared = recorder.caseStep(action, expected, data);
      if (declared === undefined) {
        const untyped: unknown = action;
        return typeof untyped === 'string' ? untyped : String(untyped);
      }
      const info = current('step');
      if (info === undefined) return action;
      const ref = (declaredSteps.get(info) ?? 0) + 1;
      declaredSteps.set(info, ref);
      attachMessage(info, { type: 'step', value: { ref, ...declared } });
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
