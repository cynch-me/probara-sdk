/**
 * The browser side of a Cypress run: the `probara.*` helpers a spec calls, the console capture and
 * the run selection. Loaded from the support file with `require('@probara/cypress-reporter/support')`
 * (or `import`), it runs in the spec frame, where **no Node built-in exists**: it reaches core's
 * browser entry and nothing else.
 *
 * The helpers apply to the test that runs, and never throw into it: a wrong argument, a helper in a
 * hook that runs no test, or a run with no plugin at all is a warning (through the plugin, so it
 * lands in the run's log) and nothing more. What each call says travels to the plugin process with
 * one `cy.task('probara', …)`, stamped with the spec and the full name of the running test; the
 * plugin writes it where the reporter of the spec reads it, and the reporter resolves the attempt
 * from its own Mocha events (see `browser-message.ts` and `reporter.ts`).
 *
 * Everything the module touches comes from an injectable {@link SupportContext}, the way the Jest
 * reporter's `installSetup(context)` does, so every part of it is unit tested without a browser.
 */
import {
  createMetadataRecorder,
  type MetadataMessage,
  type MetadataValues,
} from '@probara/core/browser';
import {
  parseSettings,
  type BrowserAttachment,
  type BrowserIdentity,
  type BrowserLine,
  type ProbaraSettings,
} from './browser-message.js';

/** A file for `probara.attach()`: a file on disk, or content in memory. */
export type ProbaraAttachment =
  | { name: string; path: string; contentType?: string }
  | { name: string; body: string | Uint8Array | ArrayBuffer; contentType?: string };

/** Values of `probara.parameters()` and `probara.fields()`; numbers and booleans become strings. */
export type ProbaraValues = MetadataValues;

/** What a step of the case a report creates expects, and the data it uses. */
export interface ProbaraStepOptions {
  /** The expected result of the step. */
  expected?: string;
  /** The data the step uses. */
  data?: string;
}

/** The line of an attachment before the bytes are known: its name and the step it is in. */
type AttachmentDraft = Omit<BrowserAttachment['line'], 'body' | 'source'>;

/** `false` keeps a command out of the Cypress log; every command of a helper is `{ log: false }`. */
export interface ChainOptions {
  log?: boolean;
}

/** The part of the `cy` chain the helpers use: `task` and `then`. */
export interface CypressChain {
  task(name: string, payload: unknown, options?: ChainOptions): CypressChain;
  then<R>(callback: (subject: unknown) => R, options?: ChainOptions): CypressChain;
}

/** What the helpers read of the `Cypress` object of the browser. */
export interface CypressBrowser {
  spec: { relative: string };
  currentTest?: { titlePath?: readonly string[] } | undefined;
  /** Reads one key back of what the plugin exposed (`config.expose`). */
  expose?: ((key: string) => unknown) | undefined;
}

/** The root hooks of a spec: the globals of the support file. */
export interface SupportHooks {
  before(fn: () => void): void;
  beforeEach(fn: () => void): void;
  afterEach(fn: () => void): void;
}

/** The `console` of the browser frame, as far as the capture wraps it. */
export interface BrowserConsole {
  log?: ((...args: unknown[]) => void) | undefined;
  info?: ((...args: unknown[]) => void) | undefined;
  debug?: ((...args: unknown[]) => void) | undefined;
  warn?: ((...args: unknown[]) => void) | undefined;
  error?: ((...args: unknown[]) => void) | undefined;
}

/** Where the browser side of a run gets everything it needs, so no test of it needs a browser. */
export interface SupportContext {
  /** Cypress's own object; `undefined` outside a Cypress run. */
  cypress(): CypressBrowser | undefined;
  /** The `cy` chain of the frame. */
  cy(): CypressChain | undefined;
  /** The root hooks of the spec (the globals of the support file). */
  hooks(): SupportHooks | undefined;
  /** The `console` of the frame, which `captureOutput` wraps. */
  console(): BrowserConsole | undefined;
  /** One warning on the console of the browser, for what the plugin cannot be told. */
  warn(message: string): void;
  /** Milliseconds on one clock, for how long a step took. */
  now(): number;
  /** A name for a step: a uuid, never a path. */
  uuid(): string;
  /** Where the helpers go: the global a spec's `probara.title()` reaches. */
  publish(probara: Probara): void;
}

/** The helpers; each metadata helper returns them, so calls chain. */
export interface Probara {
  /** Links the test to existing cases (`'SHOP-12'`, `['SHOP-12', 'SHOP-13']`). */
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
  /** Fields of the case the report creates, merged by name. */
  fields(fields: ProbaraValues): Probara;
  /** A link shown with the result, and its optional name. */
  link(url: string, name?: string): Probara;
  /** An issue of the result (`'SHOP-7'`): a link built with `issueUrlTemplate`. */
  issue(id: string): Probara;
  /**
   * Attaches a file or a body to the running attempt (to the running `probara.step()`, if any).
   * With a `body` the file is sent as it is; with a `path` the plugin reads the file (a relative
   * path from the project root, as Cypress reads one) and the chain of that task is returned, which
   * a test can wait for. A file that cannot be read is left out with one warning, never a failure.
   */
  attach(attachment: ProbaraAttachment): CypressChain | undefined;
  /**
   * A step of the attempt: `body()` queues Cypress commands, and the step ends once they ran. It
   * returns nothing: a Cypress step is not a promise, and a command that fails never ends the step
   * (the reporter fails it: the step had not finished when the test ended). Steps nest as they are
   * called. Without a body, a step that passed.
   */
  step(title: string, body?: () => void, options?: ProbaraStepOptions): void;
}

/**
 * The warning of a spec that runs no plugin of this package: reading the settings is all the
 * browser can do, and nothing of what the helpers are told is reported. It says both things that
 * can cause that, because this line is all a `cypress run` leaves behind: a Cypress console is not
 * in the output of a headless run, so the next platform where the helpers do nothing has to be
 * diagnosable from here.
 */
export const NO_PLUGIN =
  "The probara.* helpers do nothing: nothing was found at Cypress.expose('probara') when the spec ran, either because the Cypress config registers no plugin of @probara/cypress-reporter (add setupNodeEvents(on, config) { return probaraNodeEvents(on, config); } from @probara/cypress-reporter/setup to the Cypress config) or because this Cypress does not expose config.expose to the browser";

/** The warning of a helper that found no `cy` to send its message with. */
export const NO_CHANNEL =
  'The probara.* helpers could not send what they were told: there is no cy chain in this frame';

/** The stream each captured console method writes to, as Node's console names them. */
const STREAMS = {
  log: 'stdout',
  info: 'stdout',
  debug: 'stdout',
  warn: 'stderr',
  error: 'stderr',
} as const;

type Method = keyof typeof STREAMS;
type Stream = (typeof STREAMS)[Method];
type ConsoleMethod = (...args: unknown[]) => void;

/** The attachment of each stream: the names the Jest reporter and Playwright attach them under. */
const ATTACHMENTS: Readonly<Record<Stream, string>> = {
  stdout: 'stdout.log',
  stderr: 'stderr.log',
};

/**
 * The most a stream's attachment holds, in bytes: core's `MAX_ATTACHMENT_BYTES`, which this module
 * cannot import (core's entry for a browser does not export it).
 */
export const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/** The last line of an output cut at {@link MAX_OUTPUT_BYTES}: the Jest reporter's own. */
export const CUT_MARKER =
  '[probara] The output of this test was cut here: an attachment holds at most 32 MiB\n';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The name of a file without its folders, whatever the platform wrote it with. */
export function baseName(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  return base === '' ? path : base;
}

/** Bytes as base64, the form the `probara` task carries a binary body in. */
export function base64Of(bytes: Uint8Array): string {
  let binary = '';
  // A chunked spread: `String.fromCharCode(...bytes)` overflows the stack on a big file.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** The bytes of what a body is, and whether they are bytes at all (a string is text). */
export function bytesOf(body: string | Uint8Array | ArrayBuffer): {
  bytes: Uint8Array;
  binary: boolean;
} {
  if (typeof body === 'string') return { bytes: new TextEncoder().encode(body), binary: false };
  if (body instanceof ArrayBuffer) return { bytes: new Uint8Array(body), binary: true };
  return { bytes: body, binary: true };
}

/** The bytes a value a body may be: `undefined` for anything else. */
export function binaryOf(body: unknown): Uint8Array | undefined {
  if (typeof body === 'string') return undefined;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body))
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  return undefined;
}

/**
 * What a `console.log(…)` call wrote, as one line: strings as they are, everything else as JSON
 * when it can be (an object with a cycle is written as its type), and a value whose `toString`
 * throws never reaches the console twice.
 */
export function formatArgs(args: readonly unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (typeof arg === 'undefined' || arg === null) return String(arg);
      if (typeof arg === 'bigint' || typeof arg === 'symbol') return String(arg);
      if (typeof arg === 'function') return `[Function ${arg.name || 'anonymous'}]`;
      try {
        // `JSON.stringify` writes a string for what JSON holds, and nothing for the rest.
        const written = JSON.stringify(arg);
        if (typeof written === 'string') return written;
        return Object.prototype.toString.call(arg);
      } catch {
        try {
          return Object.prototype.toString.call(arg);
        } catch {
          return '[unknown]';
        }
      }
    })
    .join(' ');
}

/** What a stream of an attempt recorded: its text, its size in bytes, and whether it is full. */
interface StreamOutput {
  text: string;
  bytes: number;
  full: boolean;
}

function emptyOutput(): Record<Stream, StreamOutput> {
  return {
    stdout: { text: '', bytes: 0, full: false },
    stderr: { text: '', bytes: 0, full: false },
  };
}

/**
 * `text` added to `output`, up to {@link MAX_OUTPUT_BYTES}: what would go beyond is cut at a whole
 * character and ends with {@link CUT_MARKER}, and nothing is added after it.
 */
export function appendOutput(output: StreamOutput, text: string): void {
  const encoder = new TextEncoder();
  const size = encoder.encode(text).length;
  if (output.bytes + size <= MAX_OUTPUT_BYTES) {
    output.text += text;
    output.bytes += size;
    return;
  }
  // Room for the marker on a line of its own.
  const room = new Uint8Array(MAX_OUTPUT_BYTES - encoder.encode(CUT_MARKER).length - 1);
  const whole = output.text + text;
  const { read } = encoder.encodeInto(whole, room);
  const kept = whole.slice(0, read);
  output.text = `${kept}${kept.endsWith('\n') ? '' : '\n'}${CUT_MARKER}`;
  output.bytes = encoder.encode(output.text).length;
  output.full = true;
}

/** A uuid for a step, from the browser's own when it has one. */
export function uuidOf(): string {
  const own = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  const random =
    typeof own === 'function' ? own.call((globalThis as { crypto?: unknown }).crypto) : undefined;
  if (typeof random === 'string' && random !== '') return random;
  const hex = (): string =>
    Math.floor(Math.random() * 0x1_0000)
      .toString(16)
      .padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

/**
 * The settings of the run, read once from `Cypress.expose('probara')`: the only Node-to-browser
 * channel Cypress 16 has (`Cypress.env()` throws, `Cypress.task` is not a thing). `undefined` is a
 * run with no plugin of this package, and every helper a no-op.
 *
 * Reading it is cheap and it can be read again: {@link installSupport} does exactly that while it
 * is absent, because whether the plugin had written `config.expose` by the time the support file
 * runs is a matter of timing, not of configuration.
 */
export function readSettings(context: SupportContext): ProbaraSettings | undefined {
  const cypress = context.cypress();
  if (cypress?.expose === undefined) return undefined;
  try {
    return parseSettings(cypress.expose('probara'));
  } catch {
    // A Cypress whose `expose` refuses: no plugin, and every helper a no-op.
    return undefined;
  }
}

/**
 * Where the helpers of a run read their settings from: what the plugin exposed, or a way to read it
 * again while it is not there yet.
 *
 * Cypress sends the browser whatever `config.expose` held when `setupNodeEvents` returned, and a
 * spec's support file is loaded from there — so whether the settings are there when the support file
 * runs is a matter of timing, and a helper that decided it was off at load time would stay off for
 * the whole run, on whichever machine the timing differs.
 */
export type SettingsSource = ProbaraSettings | undefined | (() => ProbaraSettings | undefined);

/** What a {@link SettingsSource} holds right now. */
function settingsOf(source: SettingsSource): ProbaraSettings | undefined {
  return typeof source === 'function' ? source() : source;
}

/** The spec of the frame, and the test that runs (never the attempt: the reporter resolves it). */
export function identityOf(context: SupportContext): BrowserIdentity {
  const cypress = context.cypress();
  const titlePath = cypress?.currentTest?.titlePath;
  return {
    file: cypress?.spec.relative ?? '',
    test: Array.isArray(titlePath) ? titlePath.join(' ').trim() : '',
  };
}

/**
 * The helpers of `context`, whether or not a plugin registered this run. Never throws.
 *
 * `settings` is what the plugin exposed, or a way to read it again while it is absent: the helpers
 * ask for it when they are called, so a plugin that wrote `config.expose` after the support file
 * loaded is still a run that reports.
 */
export function createProbara(context: SupportContext, settings: SettingsSource): Probara {
  /** The steps running now: a stack, because Cypress runs the body of a step synchronously. */
  const steps: string[] = [];
  /** The warnings already sent: one per message, however many tests repeat it. */
  const warned = new Set<string>();
  /** What this helper told the plugin, once: the payload of every `cy.task('probara', …)`. */
  const task = (payload: unknown): CypressChain | undefined => {
    // Without a plugin there is nobody to hand it to: every helper is a no-op, and the one warning
    // the support file logged says why. Asked again every time, because a plugin that exposed its
    // settings late is a run that reports.
    if (settingsOf(settings) === undefined) return undefined;
    const cy = context.cy();
    if (cy === undefined || typeof cy.task !== 'function') {
      context.warn(NO_CHANNEL);
      return undefined;
    }
    try {
      return cy.task('probara', payload, { log: false });
    } catch (error) {
      // A Cypress that refuses the task leaves the test alone, and says why.
      context.warn(`probara.* could not send what it was told: ${messageOf(error)}`);
      return undefined;
    }
  };

  /** One warning, to the run's log when a plugin can take it, to the console otherwise. */
  function warn(message: string): void {
    if (warned.has(message)) return;
    warned.add(message);
    if (settingsOf(settings) === undefined) {
      context.warn(message);
      return;
    }
    task({ kind: 'line', line: { ...identityOf(context), type: 'warning', message } });
  }

  /** What one helper said, on its way to the plugin process. Never throws into the test. */
  function send(line: BrowserLine): void {
    task({ kind: 'line', line });
  }

  /** Runs a helper; whatever goes wrong inside is a warning, never an error of the test. */
  function guarded(helper: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      warn(`probara.${helper}() could not be recorded: ${messageOf(error)}`);
    }
  }

  const recorder = createMetadataRecorder(
    (message: MetadataMessage) => {
      send({ ...identityOf(context), type: 'message', message });
    },
    (message) => {
      warn(message);
    },
  );

  /** The line of a file to attach: its name, and the step it was attached in. */
  function attachmentLine(
    ref: BrowserIdentity,
    name: string,
    contentType: unknown,
  ): AttachmentDraft | undefined {
    if (contentType !== undefined && typeof contentType !== 'string') {
      warn(`probara.attach() could not attach "${name}": its contentType is not a string`);
      return undefined;
    }
    const step = steps[steps.length - 1];
    return {
      ...ref,
      type: 'attachment',
      ...(step === undefined ? {} : { step }),
      name,
      ...(typeof contentType === 'string' ? { contentType } : {}),
    };
  }

  /** Records the end of a step; `undefined` is a step that recorded nothing. Never throws. */
  function endStep(
    scope: { step: string; ref: BrowserIdentity; started: number } | undefined,
    status: 'passed' | 'failed',
    error?: unknown,
  ): void {
    if (scope === undefined) return;
    try {
      send({
        ...scope.ref,
        type: 'step-end',
        step: scope.step,
        status,
        durationMs: Math.max(context.now() - scope.started, 0),
        ...(status === 'failed' && error !== undefined ? { error: stepErrorOf(error) } : {}),
      });
    } catch {
      // The step stays unfinished: the reporter fails it.
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
      try {
        if (!isRecord(attachment) || typeof attachment.name !== 'string') {
          warn('probara.attach() takes { name, path } or { name, body }');
          return undefined;
        }
        const { name, path, body, contentType }: Record<string, unknown> = attachment;
        const line = attachmentLine(identityOf(context), name, contentType);
        if (line === undefined) return undefined;
        if (typeof path === 'string') {
          // The plugin reads the file, never the browser: `cy.readFile` fails the test when the
          // file is missing, and attaching a file must never fail a test. The chain of the task is
          // handed on, so the test can wait for it as it waits for any command.
          return task({
            kind: 'attachment',
            line: { ...line, source: baseName(path), body: 'bytes' },
            path,
          });
        }
        if (typeof body === 'string') {
          task({ kind: 'attachment', line: { ...line, body: 'text' }, text: body });
          return undefined;
        }
        const bytes = binaryOf(body);
        if (bytes === undefined) {
          warn(`probara.attach() could not attach "${name}": it has neither a path nor a body`);
          return undefined;
        }
        task({
          kind: 'attachment',
          line: { ...line, body: 'bytes' },
          base64: base64Of(bytes),
        });
        return undefined;
      } catch (error) {
        warn(`probara.attach() could not be recorded: ${messageOf(error)}`);
        return undefined;
      }
    },
    step(title, body, options) {
      let scope: { step: string; ref: BrowserIdentity; started: number } | undefined;
      try {
        const given: { expected?: unknown; data?: unknown } = isRecord(options) ? options : {};
        if (options !== undefined && !isRecord(options)) {
          warn('probara.step() takes its options as an object ({ expected, data })');
        }
        if (body !== undefined && typeof body !== 'function') {
          warn('probara.step() takes a function as its body');
        }
        const declared =
          recorder.caseStep(title, given.expected, given.data) ??
          (typeof title === 'string' ? { action: title } : undefined);
        // A step that recorded nothing (a wrong argument) is not a step: its body is the test's.
        if (declared !== undefined) {
          const ref = identityOf(context);
          const step = context.uuid();
          const parent = steps[steps.length - 1];
          steps.push(step);
          send({
            ...ref,
            type: 'step-start',
            step,
            ...(parent === undefined ? {} : { parent }),
            ...declared,
          });
          scope = { step, ref, started: context.now() };
        }
      } catch (error) {
        warn(`probara.step() could not be recorded: ${messageOf(error)}`);
      }
      if (typeof body !== 'function') {
        endStep(scope, 'passed');
        return;
      }
      try {
        body();
      } catch (error) {
        // A body that throws ends its step as failed, and the test sees the error as it always did.
        steps.pop();
        endStep(scope, 'failed', error);
        throw error;
      }
      // The step ends after the commands the body queued, not before them: a `cy.then` waits for
      // them, and a command that fails never runs it (the reporter fails the step then).
      steps.pop();
      const ended = scope;
      const cy = context.cy();
      if (ended === undefined || cy === undefined || typeof cy.then !== 'function') {
        endStep(ended, 'passed');
        return;
      }
      try {
        cy.then(
          () => {
            endStep(ended, 'passed');
          },
          { log: false },
        );
      } catch {
        endStep(ended, 'passed');
      }
    },
  };
  return probara;
}

/** An error as a step keeps it: what a throw of the browser frame carries. */
function stepErrorOf(error: unknown): { message?: string; stack?: string } {
  if (!isRecord(error)) return { message: String(error) };
  return {
    ...(typeof error.message === 'string' ? { message: error.message } : {}),
    ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
  };
}

/** What the capture of the console sends: one task per stream of the test that ran. */
export type OutputSend = (attachment: BrowserAttachment) => void;

/**
 * What the support file does of `captureOutput`: a root `before` wraps the console methods of the
 * frame, a root `beforeEach` opens a buffer for the test that is about to run, and a root
 * `afterEach` sends it as `stdout.log` and `stderr.log` (`text/plain`, one task per stream, the
 * Jest reporter's names and its 32 MiB cap) and puts the original methods back.
 *
 * The identity is taken in `beforeEach`, which runs inside the test: `Cypress.currentTest` still
 * holds it in `afterEach` in Cypress 16 (verified in a real run), and the captured one is what this
 * stamps either way, so a test that ends there loses nothing.
 */
export function installOutputCapture(context: SupportContext, send: OutputSend): void {
  const hooks = context.hooks();
  const consoleOf = context.console();
  if (hooks === undefined || consoleOf === undefined) return;
  const target: BrowserConsole = consoleOf;
  /** The wrappers in place, and the original method under each of them. */
  const wrappers = new Map<Method, { wrapper: ConsoleMethod; original: ConsoleMethod }>();
  /** The buffer of the test that runs. */
  let current: { identity: BrowserIdentity; output: Record<Stream, StreamOutput> } | undefined;

  /** Wraps every console method that is not wrapped yet, remembering the one under each. */
  function wrap(): void {
    for (const method of Object.keys(STREAMS) as Method[]) {
      const original = target[method];
      if (typeof original !== 'function') continue;
      if (wrappers.get(method)?.wrapper === original) continue;
      const wrapper: ConsoleMethod = (...args: unknown[]): void => {
        // Only what the test that is running wrote itself, and only while its stream has room.
        const capture = current;
        if (capture !== undefined) {
          try {
            const output = capture.output[STREAMS[method]];
            if (!output.full) appendOutput(output, `${formatArgs(args)}\n`);
          } catch {
            // The console prints it all the same; only the copy is lost.
          }
        }
        // The frame's console keeps printing what the test wrote, captured or not.
        original(...args);
      };
      target[method] = wrapper;
      wrappers.set(method, { wrapper, original });
    }
  }

  /** Puts the original method back under every wrapper that is still in place. */
  function unwrap(): void {
    for (const [method, { wrapper, original }] of wrappers) {
      // A method the test replaced is the test's to restore: the wrapper under it prints now.
      if (target[method] === wrapper) target[method] = original;
    }
  }

  try {
    hooks.before(wrap);
    hooks.beforeEach(() => {
      // The `afterEach` of the test before put the methods back: they are wrapped again for this one.
      wrap();
      current = { identity: identityOf(context), output: emptyOutput() };
    });
    hooks.afterEach(() => {
      const capture = current;
      current = undefined;
      if (capture === undefined) return;
      try {
        unwrap();
        for (const stream of ['stdout', 'stderr'] as const) {
          const { text } = capture.output[stream];
          if (text === '') continue;
          send({
            kind: 'attachment',
            line: {
              ...capture.identity,
              type: 'attachment',
              name: ATTACHMENTS[stream],
              contentType: 'text/plain',
              body: 'text',
            },
            text,
          });
        }
      } catch {
        // The output of this test is lost, never the test.
      }
    });
  } catch {
    // No capture for this spec: nothing is wrapped, nothing is sent.
  }
}

/**
 * What the support file does of `runCasesOnly`: one root `beforeEach` asks the plugin whether the
 * test that is running is in the selection, and `this.skip()`s it when it is not (the task is
 * queued there, so the answer comes before the test decides what to do). Every test runs when
 * there is no selection, or when the answer never came.
 */
export function installSelection(
  context: SupportContext,
  selected: (answer: unknown) => boolean,
): void {
  const hooks = context.hooks();
  if (hooks === undefined) return;
  try {
    // A plain function, not an arrow: `this.skip()` is Mocha's own context of the hook.
    hooks.beforeEach(function skipUnselected(this: { skip?: () => void }): void {
      const chain = context.cy();
      if (chain === undefined || typeof chain.task !== 'function') return;
      const titlePath = context.cypress()?.currentTest?.titlePath;
      chain
        .task(
          'probara',
          {
            kind: 'select',
            file: context.cypress()?.spec.relative ?? '',
            titlePath: Array.isArray(titlePath) ? titlePath.map((each) => String(each)) : [],
          },
          { log: false },
        )
        .then((answer) => {
          if (!selected(answer)) this.skip?.();
        });
    });
  } catch {
    // Every test runs: a selection that cannot be asked never skips a test.
  }
}

/**
 * Reads the settings of the run, publishes the helpers, and turns on what the settings ask for.
 * Does nothing without a Cypress (a unit test, a Node script) and never throws into one.
 *
 * The settings are read when the support file loads and again while they are still absent, and
 * {@link createProbara} asks for them on every call: a plugin that wrote `config.expose` after this
 * module ran is a run that reports, not one without a plugin. The warning that nothing was found is
 * therefore said where a plugin still had a chance to appear — the first hook of the spec — and not
 * at load time, where it would accuse a plugin that is about to write.
 */
export function installSupport(context: SupportContext): void {
  try {
    if (context.cypress() === undefined) return;
    let found: ProbaraSettings | undefined = readSettings(context);
    /** The settings of this run: read again while they are absent, kept once they are there. */
    const settings = (): ProbaraSettings | undefined => {
      found ??= readSettings(context);
      return found;
    };
    context.publish(createProbara(context, settings));
    /** What the settings ask for, turned on once, wherever they are first read. */
    let turned = false;
    const turnOn = (): void => {
      if (turned) return;
      const known = settings();
      if (known === undefined) return;
      turned = true;
      if (known.captureOutput) installOutputCapture(context, sendOutputOf(context));
      // The cases of the run are asked for per test: Cypress freezes what it exposes to the browser
      // when `setupNodeEvents` returns, and they can only be read after that (see `browser-message`).
      if (known.runCasesOnly) installSelection(context, isSelected);
    };
    /** Whether the warning of a spec with no plugin was said: once, however many hooks run. */
    let said = false;
    const check = (): void => {
      turnOn();
      if (turned || said) return;
      said = true;
      context.warn(NO_PLUGIN);
    };
    turnOn();
    const hooks = context.hooks();
    if (hooks === undefined) {
      // Nothing will run where the settings could still appear: what there is, is what there will be.
      check();
      return;
    }
    hooks.before(check);
    hooks.beforeEach(check);
  } catch {
    // The helpers are off for this spec; the reporter, its screenshots and its video never need them.
  }
}

/** The task of the console capture: one attachment per stream of the test that ran. */
function sendOutputOf(context: SupportContext): OutputSend {
  return (attachment) => {
    const cy = context.cy();
    if (cy === undefined || typeof cy.task !== 'function') {
      context.warn(NO_CHANNEL);
      return;
    }
    try {
      cy.task('probara', attachment, { log: false });
    } catch {
      // The output of this test is lost, never the test.
    }
  };
}

/** The answer of the plugin to a `select`: `true` for the tests of the run's cases. */
export function isSelected(answer: unknown): boolean {
  return isRecord(answer) && answer.selected === true;
}

declare global {
  /** The helpers, as a Cypress spec's `probara.*` reaches them. */
  const probara: Probara;
}
