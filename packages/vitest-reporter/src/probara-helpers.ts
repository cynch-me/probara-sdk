/**
 * The `probara.*` helpers of a Vitest test: what a test tells the reporter about itself, from its body
 * or its `beforeEach` and `afterEach` hooks. The same API as the Jest reporter's (`probara.ts` there).
 * Every helper applies to the running attempt only, and never throws into the test: a wrong argument,
 * or a call while no test runs, is one warning. Without the reporter, every helper does nothing, and
 * `probara.step()` still runs its body.
 *
 * What a helper writes goes to the running attempt's lines on `task.meta.probara` (Vitest's own
 * metadata channel, V-D7): the reporter reads them back with core's `detailsOf`, after the run, so the
 * lines survive a blob and `--merge-reports`. This module is platform-neutral (no Node import): the Node
 * entry (`probara.ts`) and the browser entry (`browser.ts`) bring the step context and the clock.
 */
import type { AttemptRef, ChannelLine, MetadataMessage, MetadataValues } from '@probara/core';
import { createMetadataRecorder } from '@probara/core/metadata';
import { sameTry, tryOf, type ProbaraTaskMeta } from './attempts.js';
import type { CurrentTest, RunningTest } from './current-test-slot.js';

/** A file for `probara.attach()`: a file on disk, or content in memory. */
export type ProbaraAttachment =
  | { name: string; path: string; contentType?: string }
  | { name: string; body: string | Uint8Array; contentType?: string };

/** What the helpers copy or write for a file of `probara.attach()`: its path, or its content. */
export type StageInput = { path: string } | { body: string | ArrayBufferView };

/** A file copied into the run's folder: the copy's UUID, and what the transport needs to name it. */
export interface StagedFile {
  copy: string;
  /** The base name of the attached file, for a `path`. */
  source?: string;
  /** For a body: `text` for a string, `bytes` for other content. */
  body?: 'text' | 'bytes';
}

/** The outcome of staging a file: the copy, or the reason the file is left out. */
export type StageOutcome = { staged: StagedFile } | { problem: string };

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
   * A link shown with the result (`'https://ci.example.com/build/12'`, named `'Build'`): an absolute
   * http(s) URL, and an optional name.
   */
  link(url: string, name?: string): Probara;
  /**
   * An issue of the result (`'SHOP-7'`): a link built with the reporter's `issueUrlTemplate`
   * (`%s` is the id, URL-encoded), named by the id. Without a template it is dropped, with a warning.
   */
  issue(id: string): Probara;
  /**
   * Attaches a file or a body to the attempt. A relative path is read from the working directory.
   */
  attach(attachment: ProbaraAttachment): Promise<void>;
  /**
   * A step of the attempt: runs `body` and returns what it returns, rethrowing its error; the step
   * passes, or fails with that error. For a promise (an async body) it returns a promise that settles
   * the same way once the step ended: a rejection the test never awaits is still an unhandled
   * rejection, which fails the test, exactly as without the reporter. Steps nest as they run. The
   * outermost steps are the steps of the case the report creates, with `expected` and `data`. Without a
   * body, a step that passed.
   */
  step<T = void>(title: string, body?: () => T, options?: ProbaraStepOptions): T;
}

/** A step the helpers started: its attempt, and its id in the attempt's lines. */
export interface StepScope {
  readonly ref: AttemptRef;
  /** The lines of the attempt the step belongs to. */
  readonly lines: ChannelLine[];
  readonly step: string;
}

/** The step the running async flow is in, which a step started inside it nests under. */
export interface StepContext {
  get(): StepScope | undefined;
  run<T>(scope: StepScope, body: () => T): T;
}

/** What the platform gives the helpers: the slot of the running test, the step context and the clock. */
export interface HelpersRuntime {
  /** Whether a reporter runs in this worker: without one, every helper does nothing. */
  active(): boolean;
  /** The running test of the calling flow, if any. */
  current(): CurrentTest | undefined;
  steps: StepContext;
  /** Real time, in milliseconds (`performance.now()`). */
  now(): number;
  /** An id that is unique within an attempt. */
  newId(): string;
  /**
   * Copies a file, or writes a body, into the run's folder: `undefined` when the run has no folder. Absent
   * where files cannot be copied yet (the browser entry): `attach()` says so.
   */
  stage?: (input: StageInput) => StageOutcome | undefined | Promise<StageOutcome | undefined>;
}

/** Where a call happens that belongs to no test. */
const OUTSIDE_TEST = 'only works while a test runs (in a test, or a beforeEach or afterEach hook)';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Whether `value` is a promise, of any realm. Watching it settle has no effect of its own, and nothing
 * else is called: another thenable may start itself when its `then()` is called.
 */
function isPromise(value: unknown): value is Promise<unknown> {
  return Object.prototype.toString.call(value) === '[object Promise]';
}

function messageOf(error: unknown): string {
  return isRecord(error) && typeof error.message === 'string' ? error.message : String(error);
}

/** An error as a step keeps it; errors of another realm included. */
function stepErrorOf(error: unknown): { message?: string; stack?: string } {
  if (!isRecord(error)) return { message: String(error) };
  return {
    ...(typeof error.message === 'string' ? { message: error.message } : {}),
    ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
  };
}

/**
 * The lines of the attempt a helper writes to: the running attempt's, or the test's own list when no
 * attempt is recorded (the setup file is not registered for its project). That list belongs to one try:
 * a new try starts an empty one, so an earlier try's lines never reach the final execution (V-D71).
 */
function linesOf(test: RunningTest): ChannelLine[] {
  const probara = (test.meta.probara ??= {}) as ProbaraTaskMeta;
  const attempt = probara.attempts?.at(-1);
  if (attempt !== undefined) return (attempt.lines ??= []);
  const now = tryOf(test.result ?? {});
  if (probara.lines === undefined || !sameTry(probara.linesTry, now)) probara.lines = [];
  probara.linesTry = now;
  return probara.lines;
}

/** The reference of the lines of `test`: its file, its name, and the number of its attempt. */
function refOf(test: RunningTest): AttemptRef {
  const attempts = (test.meta.probara as ProbaraTaskMeta | undefined)?.attempts;
  return {
    file: test.file?.filepath ?? '',
    test: test.name,
    attempt: Math.max(0, (attempts?.length ?? 1) - 1),
  };
}

/** The helpers, reading the running test from `runtime`. */
export function createProbaraHelpers(runtime: HelpersRuntime): Probara {
  /** The helpers that already warned about a call outside a test: one warning each. */
  const warnedOutside = new Set<string>();
  /** Messages already printed on the console: each once. */
  const warnedNow = new Set<string>();

  /** A warning the reporter cannot attribute to a test: printed once, on the console of the worker. */
  function warnNow(message: string): void {
    if (warnedNow.has(message)) return;
    warnedNow.add(message);
    console.warn(`[probara] ${message}`);
  }

  /** Whether a call of the running test cannot be attributed to it: a concurrent test with no store. */
  function unattributed(found: CurrentTest): boolean {
    return !found.exact && found.test.concurrent === true;
  }

  /** The running test's attempt, the lines of which the helper writes to; `undefined` otherwise. */
  function target(
    helper: string,
  ): { lines: ChannelLine[]; ref: AttemptRef; test: RunningTest } | undefined {
    if (!runtime.active()) return undefined;
    const found = runtime.current();
    if (found === undefined) {
      if (!warnedOutside.has(helper)) {
        warnedOutside.add(helper);
        warnNow(`probara.${helper}() ${OUTSIDE_TEST}`);
      }
      return undefined;
    }
    if (unattributed(found)) {
      warnNow(
        `probara.${helper}() is dropped in a concurrent test: this worker cannot tell which test calls it without the reporter's runner`,
      );
      return undefined;
    }
    return { lines: linesOf(found.test), ref: refOf(found.test), test: found.test };
  }

  /** A warning about a call of the running test: it travels with the test's lines, and the reporter prints it once. */
  function warnInTest(message: string): void {
    if (!runtime.active()) return;
    const found = runtime.current();
    if (found === undefined || unattributed(found)) {
      warnNow(message);
      return;
    }
    linesOf(found.test).push({ type: 'warning', message });
  }

  const recorder = createMetadataRecorder(
    (message: MetadataMessage) => {
      const found = target(message.type);
      if (found !== undefined) found.lines.push({ ...found.ref, type: 'message', message });
    },
    (message) => {
      warnInTest(message);
    },
  );

  /**
   * Records a file or a body of `attachment` on the running attempt. It is copied (or written) at once, so
   * a file removed right after the call is still attached, and one `attachment` line names the copy with
   * the step it is in (V-D65). Whatever is left out is one warning that says why.
   */
  function attachNow(attachment: unknown): Promise<void> | undefined {
    if (!isRecord(attachment) || typeof attachment.name !== 'string') {
      warnInTest('probara.attach() takes { name, path } or { name, body }');
      return undefined;
    }
    const { name, path, body, contentType } = attachment;
    if (contentType !== undefined && typeof contentType !== 'string') {
      warnInTest(`probara.attach() could not attach "${name}": its contentType is not a string`);
      return undefined;
    }
    const source: StageInput | undefined =
      typeof path === 'string'
        ? { path }
        : typeof body === 'string' || ArrayBuffer.isView(body)
          ? { body }
          : undefined;
    if (source === undefined) {
      warnInTest(`probara.attach() could not attach "${name}": it has neither a path nor a body`);
      return undefined;
    }
    // The attempt and the step are those of the call: an async copy (a browser's) records into them when it ends.
    const found = target('attach');
    if (found === undefined) return undefined;
    const parent = runtime.steps.get();
    const step = parent !== undefined && parent.lines === found.lines ? { step: parent.step } : {};
    if (runtime.stage === undefined) {
      warnInTest(`probara.attach() does not attach files in this run: "${name}" is left out`);
      return undefined;
    }
    const record = (outcome: StageOutcome | undefined): void => {
      if (outcome === undefined) {
        warnInTest(
          `probara.attach() could not attach "${name}": this run has no attachments folder`,
        );
        return;
      }
      if ('problem' in outcome) {
        warnInTest(`probara.attach() did not attach "${name}": ${outcome.problem}`);
        return;
      }
      found.lines.push({
        ...found.ref,
        type: 'attachment',
        name,
        ...(contentType === undefined ? {} : { contentType }),
        ...step,
        ...outcome.staged,
      });
    };
    const outcome = runtime.stage(source);
    if (outcome instanceof Promise) {
      return outcome.then(record, (error: unknown) => {
        warnInTest(`probara.attach() could not attach "${name}": ${messageOf(error)}`);
      });
    }
    record(outcome);
    return undefined;
  }

  /** Starts a step: its declaration is checked, and its start recorded in the running attempt. */
  function startStep(title: unknown, body: unknown, options: unknown): StepScope | undefined {
    let given: Record<string, unknown> = {};
    if (isRecord(options)) given = options;
    else if (options !== undefined) {
      warnInTest('probara.step() takes its options as an object ({ expected, data })');
    }
    if (body !== undefined && typeof body !== 'function') {
      warnInTest('probara.step() takes a function as its body');
    }
    const declared =
      recorder.caseStep(title, given.expected, given.data) ??
      (typeof title === 'string' ? { action: title } : undefined);
    if (declared === undefined) return undefined;
    const found = target('step');
    if (found === undefined) return undefined;
    const parent = runtime.steps.get();
    const step = runtime.newId();
    found.lines.push({
      ...found.ref,
      type: 'step-start',
      step,
      ...(parent !== undefined && parent.lines === found.lines ? { parent: parent.step } : {}),
      ...declared,
    });
    return { ref: found.ref, lines: found.lines, step };
  }

  /** Records the end of a started step; never throws. */
  function endStep(
    scope: StepScope | undefined,
    started: number,
    status: 'passed' | 'failed',
    error?: unknown,
  ): void {
    if (scope === undefined) return;
    try {
      scope.lines.push({
        ...scope.ref,
        type: 'step-end',
        step: scope.step,
        status,
        durationMs: runtime.now() - started,
        ...(status === 'failed' ? { error: stepErrorOf(error) } : {}),
      });
    } catch {
      // The step stays unfinished: the reporter fails it, with the reason core gives.
    }
  }

  /** Runs a helper; whatever goes wrong inside is a warning, never an error of the test. */
  /**
   * Runs a helper that may finish later (`attach()` of a browser copies a file through the Node side): the promise it
   * returns resolves once the helper recorded, and whatever goes wrong, sync or later, is a warning, never an error.
   */
  function guardedAsync(helper: string, run: () => Promise<void> | undefined): Promise<void> {
    try {
      return Promise.resolve(run()).catch((error: unknown) => {
        warnInTest(`probara.${helper}() could not be recorded: ${messageOf(error)}`);
      });
    } catch (error) {
      warnInTest(`probara.${helper}() could not be recorded: ${messageOf(error)}`);
      return Promise.resolve();
    }
  }

  function guarded(helper: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      warnInTest(`probara.${helper}() could not be recorded: ${messageOf(error)}`);
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
    link(url, name) {
      guarded('link', () => {
        recorder.link(url, name);
      });
      return probara;
    },
    issue(id) {
      guarded('issue', () => {
        recorder.issue(id);
      });
      return probara;
    },
    attach(attachment) {
      return guardedAsync('attach', () => attachNow(attachment));
    },
    step<T = void>(title: string, body?: () => T, options?: ProbaraStepOptions): T {
      let scope: StepScope | undefined;
      guarded('step', () => {
        scope = startStep(title, body, options);
      });
      const started = runtime.now();
      if (typeof body !== 'function') {
        endStep(scope, started, 'passed');
        return undefined as T;
      }
      let result: T;
      try {
        result = scope === undefined ? body() : runtime.steps.run(scope, body);
      } catch (error) {
        endStep(scope, started, 'failed', error);
        throw error;
      }
      if (scope === undefined || !isPromise(result)) {
        endStep(scope, started, 'passed');
        return result;
      }
      // The chain ends the step and settles like the body's promise: a rejection the test never handles
      // stays an unhandled rejection, as without the reporter.
      const ended = scope;
      return result.then(
        (value: unknown) => {
          endStep(ended, started, 'passed');
          return value;
        },
        (error: unknown) => {
          endStep(ended, started, 'failed', error);
          throw error;
        },
      ) as T;
    },
  };
  return probara;
}
