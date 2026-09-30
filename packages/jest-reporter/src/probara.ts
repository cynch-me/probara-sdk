/**
 * `probara.*`: what a Jest test tells the reporter about itself, from its body or its `beforeEach`
 * and `afterEach` hooks. Every helper applies to the running attempt only, and never throws into
 * the test: a wrong argument, or a call while no test runs, is one warning the reporter logs.
 * Without the reporter, every helper does nothing, and `probara.step()` still runs its body.
 *
 * Loaded inside Jest's test sandbox: Node built-ins and `@probara/core/metadata` only.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { copyFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  createMetadataRecorder,
  type MetadataMessage,
  type MetadataValues,
} from '@probara/core/metadata';
import {
  appendLine,
  CHANNEL_VARIABLE,
  FILES_FOLDER,
  type AttemptRef,
  type ChannelLine,
  type StepError,
} from './channel.js';
import { currentTest, currentTestFile, type CurrentTest } from './current-test.js';

/** A file for `probara.attach()`: a file on disk, or content in memory. */
export type ProbaraAttachment =
  | { name: string; path: string; contentType?: string }
  | { name: string; body: string | Uint8Array; contentType?: string };

/** Values of `probara.parameters()` and `probara.fields()`; numbers and booleans become strings. */
export type ProbaraValues = MetadataValues;

/** What a step of the case a report creates expects, and the data it uses. */
export interface ProbaraStepOptions {
  /** The expected result of the step. */
  expected?: string;
  /** The data the step uses. */
  data?: string;
}

/** The helpers; each metadata helper returns them, so calls chain. */
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
  /**
   * Attaches a file or a body to the attempt (to the running `probara.step()`, if any). The file is
   * copied when called: deleting it afterwards loses nothing. A relative path is read from the
   * working directory.
   */
  attach(attachment: ProbaraAttachment): Promise<void>;
  /**
   * A step of the attempt: runs `body` and returns what it returns (its promise, when async),
   * rethrowing its error; the step passes, or fails with that error. Steps nest as they run. The
   * outermost steps are the steps of the case the report creates, with `expected` and `data`.
   * Without a body, a step that passed.
   */
  step<T = void>(title: string, body?: () => T, options?: ProbaraStepOptions): T;
}

/** Where the helpers write and which attempt runs. */
export interface ProbaraContext {
  /** The channel directory, while the reporter runs; `undefined` makes every helper a no-op. */
  channel(): string | undefined;
  /** The test attempt running now, if any. */
  currentTest(): CurrentTest | undefined;
  /** The test file running now, even outside a test, to name it in a warning. */
  testFile?(): string | undefined;
}

/** Where a call happens that belongs to no test. */
const OUTSIDE_TEST = 'only works while a test runs (in a test, or a beforeEach or afterEach hook)';

/** The running step, for its children and the files attached inside it. */
interface StepScope {
  ref: AttemptRef;
  step: string;
}

/** Real time: `performance` of Node, never the one fake timers replace on the global. */
const now = performance.now.bind(performance);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function messageOf(error: unknown): string {
  return isRecord(error) && typeof error.message === 'string' ? error.message : String(error);
}

/** An error as a step keeps it; errors of another realm (the sandbox's) included. */
function stepErrorOf(error: unknown): StepError {
  if (!isRecord(error)) return { message: String(error) };
  return {
    ...(typeof error.message === 'string' ? { message: error.message } : {}),
    ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
  };
}

/** The helpers, writing to the channel `context` names, for the test it says runs. */
export function createProbara(context: ProbaraContext): Probara {
  const steps = new AsyncLocalStorage<StepScope>();
  /** Helpers that already warned about a call outside a test: one warning each. */
  const warnedOutside = new Set<string>();

  function write(dir: string, line: ChannelLine): void {
    appendLine(dir, line);
  }

  /**
   * One warning, for the reporter to log, naming the test (or else the file) it came from; lost,
   * silently, if even that cannot be written.
   */
  function warn(message: string, test?: CurrentTest): void {
    const dir = context.channel();
    if (dir === undefined) return;
    try {
      const file = test?.file ?? context.testFile?.();
      write(dir, {
        type: 'warning',
        message,
        ...(file === undefined ? {} : { file }),
        ...(test === undefined ? {} : { test: test.test }),
      });
    } catch {
      // The channel is gone: nothing can reach the reporter any more.
    }
  }

  /** The channel and the running attempt, or `undefined` (after a warning outside a test). */
  function target(helper: string): { dir: string; ref: AttemptRef } | undefined {
    const dir = context.channel();
    if (dir === undefined) return undefined;
    const test = context.currentTest();
    if (test === undefined) {
      if (!warnedOutside.has(helper)) {
        warnedOutside.add(helper);
        warn(`probara.${helper}() ${OUTSIDE_TEST}`);
      }
      return undefined;
    }
    return { dir, ref: { file: test.file, test: test.test, attempt: test.attempt } };
  }

  /**
   * The step running in this async context. A step of another attempt (left running) is no parent:
   * the reporter nests a step only under a step of its own attempt.
   */
  function runningStep(): string | undefined {
    return steps.getStore()?.step;
  }

  const recorder = createMetadataRecorder(
    (message: MetadataMessage) => {
      const found = target(message.type);
      if (found !== undefined) write(found.dir, { ...found.ref, type: 'message', message });
    },
    (message) => {
      warn(message, context.currentTest());
    },
  );

  /** Copies the file or writes the body of `attachment` into the channel, and records it. */
  function attachNow(attachment: unknown): void {
    if (!isRecord(attachment) || typeof attachment.name !== 'string') {
      warn('probara.attach() takes { name, path } or { name, body }', context.currentTest());
      return;
    }
    const { name, path, body, contentType } = attachment;
    const found = target('attach');
    if (found === undefined) return;
    const { dir, ref } = found;
    const fail = (reason: string) => {
      warn(`probara.attach() could not attach "${name}": ${reason}`, context.currentTest());
    };
    if (contentType !== undefined && typeof contentType !== 'string') {
      fail('its contentType is not a string');
      return;
    }
    const copy = randomUUID();
    const destination = join(dir, FILES_FOLDER, copy);
    let source: Pick<Extract<ChannelLine, { type: 'attachment' }>, 'source' | 'body'>;
    try {
      if (typeof path === 'string') {
        const absolute = resolve(process.cwd(), path);
        copyFileSync(absolute, destination);
        source = { source: basename(absolute) };
      } else if (typeof body === 'string') {
        writeFileSync(destination, body);
        source = { body: 'text' };
      } else if (ArrayBuffer.isView(body)) {
        // Any view, of any realm (a Buffer is not a Uint8Array of the sandbox's).
        writeFileSync(destination, new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
        source = { body: 'bytes' };
      } else {
        fail('it has neither a path nor a body');
        return;
      }
    } catch (error) {
      fail(messageOf(error));
      return;
    }
    const step = runningStep();
    write(dir, {
      ...ref,
      type: 'attachment',
      ...(step === undefined ? {} : { step }),
      name,
      ...(contentType === undefined ? {} : { contentType }),
      copy,
      ...source,
    });
  }

  /** Records the start of a step; its scope, or `undefined` when it is not recorded. */
  function startStep(title: unknown, body: unknown, options: unknown): StepScope | undefined {
    const test = context.currentTest();
    let given: { expected?: unknown; data?: unknown } = {};
    if (isRecord(options)) given = options;
    else if (options !== undefined) {
      warn('probara.step() takes its options as an object ({ expected, data })', test);
    }
    if (body !== undefined && typeof body !== 'function') {
      warn('probara.step() takes a function as its body', test);
    }
    const declared =
      recorder.caseStep(title, given.expected, given.data) ??
      (typeof title === 'string' ? { action: title } : undefined);
    if (declared === undefined) return undefined;
    const found = target('step');
    if (found === undefined) return undefined;
    const { dir, ref } = found;
    const parent = runningStep();
    const step = randomUUID();
    write(dir, {
      ...ref,
      type: 'step-start',
      step,
      ...(parent === undefined ? {} : { parent }),
      ...declared,
    });
    return { ref, step };
  }

  /** Records the end of a started step; never throws. */
  function endStep(
    scope: StepScope | undefined,
    started: number,
    status: 'passed' | 'failed',
    error?: unknown,
  ): void {
    if (scope === undefined) return;
    const dir = context.channel();
    if (dir === undefined) return;
    try {
      write(dir, {
        ...scope.ref,
        type: 'step-end',
        step: scope.step,
        status,
        durationMs: now() - started,
        ...(status === 'failed' ? { error: stepErrorOf(error) } : {}),
      });
    } catch {
      // The step stays unfinished: the reporter fails it.
    }
  }

  /** Runs a helper; whatever goes wrong inside is a warning, never an error of the test. */
  function guarded(helper: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      warn(`probara.${helper}() could not be recorded: ${messageOf(error)}`, context.currentTest());
    }
  }

  const probara: Probara = {
    id(ids) {
      guarded('id', () => {
        recorder.id(ids);
      });
      return probara;
    },
    title(title) {
      guarded('title', () => {
        recorder.title(title);
      });
      return probara;
    },
    suite(path) {
      guarded('suite', () => {
        recorder.suite(path);
      });
      return probara;
    },
    comment(comment) {
      guarded('comment', () => {
        recorder.comment(comment);
      });
      return probara;
    },
    ignore() {
      guarded('ignore', () => {
        recorder.ignore();
      });
      return probara;
    },
    parameters(parameters) {
      guarded('parameters', () => {
        recorder.parameters(parameters);
      });
      return probara;
    },
    tags(...tags) {
      guarded('tags', () => {
        recorder.tags(...tags);
      });
      return probara;
    },
    fields(fields) {
      guarded('fields', () => {
        recorder.fields(fields);
      });
      return probara;
    },
    attach(attachment) {
      guarded('attach', () => {
        attachNow(attachment);
      });
      return Promise.resolve();
    },
    step<T = void>(title: string, body?: () => T, options?: ProbaraStepOptions): T {
      let scope: StepScope | undefined;
      guarded('step', () => {
        scope = startStep(title, body, options);
      });
      const started = now();
      if (typeof body !== 'function') {
        endStep(scope, started, 'passed');
        return undefined as T;
      }
      let result: T;
      try {
        result = scope === undefined ? body() : steps.run(scope, body);
      } catch (error) {
        endStep(scope, started, 'failed', error);
        throw error;
      }
      if (scope === undefined || !isThenable(result)) {
        endStep(scope, started, 'passed');
        return result;
      }
      return result.then(
        (value) => {
          endStep(scope, started, 'passed');
          return value;
        },
        (error: unknown) => {
          endStep(scope, started, 'failed', error);
          throw error;
        },
      ) as T;
    },
  };
  return probara;
}

/**
 * The helpers of the running Jest test: `const { probara } = require('@probara/jest-reporter')`,
 * or `import { probara } from '@probara/jest-reporter'`.
 */
export const probara: Probara = createProbara({
  channel: () => {
    const dir = process.env[CHANNEL_VARIABLE];
    return dir === undefined || dir === '' ? undefined : dir;
  },
  currentTest: () => currentTest(globalThis),
  testFile: () => currentTestFile(globalThis),
});
