/**
 * The protocol between the browser side of a Cypress run and the plugin process: what
 * `Cypress.expose('probara')` holds, and what a `cy.task('probara', …)` may carry.
 *
 * The browser stamps the IDENTITY of every message (the spec, and the test that runs) and never
 * the attempt: the reporter resolves the attempt from its own Mocha events, in its own process
 * (see `reporter.ts`). Every kind here is one of core's `ChannelLine` kinds without its `attempt`,
 * which the plugin fills with nothing and the reporter fills in by matching.
 *
 * Node-free: it is loaded in the spec frame and in the plugin process alike.
 */
import type { MetadataMessage, StepError } from '@probara/core/browser';

/**
 * What the browser side of a run needs, as `Cypress.expose('probara')` reads it back.
 *
 * `runCasesOnly` is a flag and not the cases themselves: Cypress sends the browser what
 * `config.expose` holds when `setupNodeEvents` returns, and the cases of a run can only be read
 * after that (it is an API call). The browser therefore asks the plugin for each test with a
 * `select` message, and the plugin answers out of the cases it read (see `setup.ts`).
 */
export interface ProbaraSettings {
  /** The version of the package that registered the plugin. */
  version: string;
  /** Send what each test writes to the console as `stdout.log` and `stderr.log`. */
  captureOutput: boolean;
  /** Ask the plugin, before each test, whether the run's cases take it. */
  runCasesOnly: boolean;
}

/**
 * The settings the plugin exposed, or `undefined` when there are none: no plugin registered this
 * run, and every `probara.*` helper is a no-op. Never throws.
 */
export function parseSettings(value: unknown): ProbaraSettings | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { version, captureOutput, runCasesOnly } = value as Record<string, unknown>;
  if (typeof version !== 'string' || version === '') return undefined;
  return {
    version,
    captureOutput: captureOutput === true,
    runCasesOnly: runCasesOnly === true,
  };
}

/** The identity every message of the browser carries: the spec, and the test that is running. */
export interface BrowserIdentity {
  /** `Cypress.spec.relative`, like the `file` of the reporter's own results. */
  file: string;
  /**
   * The full name of the test: `Cypress.currentTest.titlePath` joined by spaces, which is what the
   * reporter builds from its suite stack and the title of the test. Empty when no test runs.
   */
  test: string;
}

/** One line of the transport as the browser sends it: a core kind, without its attempt. */
export type BrowserLine = BrowserIdentity &
  (
    | { type: 'message'; message: MetadataMessage }
    | {
        type: 'step-start';
        step: string;
        parent?: string;
        action: string;
        expected?: string;
        data?: string;
      }
    | {
        type: 'step-end';
        step: string;
        status: 'passed' | 'failed';
        durationMs: number;
        error?: StepError;
      }
    | { type: 'warning'; message: string }
  );

/** An attached file as the browser sends it: the line, and the bytes out of the line. */
export interface BrowserAttachment {
  kind: 'attachment';
  line: BrowserIdentity & {
    type: 'attachment';
    /** The step running when the file was attached. */
    step?: string;
    name: string;
    contentType?: string;
    /** The base name of the file it was read from; none for a body. */
    source?: string;
    body: 'text' | 'bytes';
  };
  /** The body of a `text` attachment. */
  text?: string;
  /** The bytes of a `bytes` attachment, base64. */
  base64?: string;
}

/** What a `cy.task('probara', …)` carries: a line, a file to copy, or a question about the run. */
export type ProbaraPayload =
  | { kind: 'line'; line: BrowserLine }
  | BrowserAttachment
  | {
      kind: 'select';
      file: string;
      /** `Cypress.currentTest.titlePath`: the describes and the title, outermost first. */
      titlePath: string[];
    };

/** The answer of the plugin to `select`: whether the test that asked is in the run's selection. */
export interface SelectionAnswer {
  selected: boolean;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((each) => typeof each === 'string');
}

/**
 * What `payload` is: a {@link ProbaraPayload}, or `undefined` for anything else (a payload the
 * support file of another version sent, or a value a test called the task with), which the plugin
 * drops rather than reporting. Never throws.
 */
export function payloadOf(value: unknown): ProbaraPayload | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const payload = value as Record<string, unknown>;
  switch (payload.kind) {
    case 'line':
      return isBrowserLine(payload.line) ? { kind: 'line', line: payload.line } : undefined;
    case 'attachment':
      return isBrowserAttachment(payload) ? payload : undefined;
    case 'select':
      return typeof payload.file === 'string' && isStringList(payload.titlePath)
        ? { kind: 'select', file: payload.file, titlePath: payload.titlePath }
        : undefined;
    default:
      return undefined;
  }
}

function identityOf(value: unknown): BrowserIdentity | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { file, test } = value as Record<string, unknown>;
  if (typeof file !== 'string' || typeof test !== 'string') return undefined;
  return { file, test };
}

/** Whether `value` is a {@link BrowserLine}: an identity and one of the kinds that carry one. */
export function isBrowserLine(value: unknown): value is BrowserLine {
  if (identityOf(value) === undefined) return false;
  const line = value as Record<string, unknown>;
  switch (line.type) {
    case 'message':
      return typeof line.message === 'object' && line.message !== null;
    case 'step-start':
      return typeof line.step === 'string' && typeof line.action === 'string';
    case 'step-end':
      return (
        typeof line.step === 'string' && (line.status === 'passed' || line.status === 'failed')
      );
    case 'warning':
      return typeof line.message === 'string';
    default:
      return false;
  }
}

function isBrowserAttachment(value: unknown): value is BrowserAttachment {
  const payload = value as Record<string, unknown>;
  const line = payload.line;
  if (typeof line !== 'object' || line === null) return false;
  if (identityOf(line) === undefined) return false;
  const { type, name, body } = line as Record<string, unknown>;
  if (type !== 'attachment' || typeof name !== 'string') return false;
  if (body !== 'text' && body !== 'bytes') return false;
  return body === 'text' ? typeof payload.text === 'string' : typeof payload.base64 === 'string';
}

/** The helper a line came from, for a warning about a line that belongs to no attempt. */
export function labelOf(line: BrowserLine): string {
  if (line.type === 'message') return `probara.${line.message.type}()`;
  if (line.type === 'step-start' || line.type === 'step-end') return 'probara.step()';
  return 'a probara.* warning';
}

/** The helper an attachment came from, for the same warning. */
export const ATTACH_LABEL = 'probara.attach()';

/**
 * Whether `line` is about the test `test` of the spec at `file`: the identity the browser stamped.
 * A line with no test (a helper in a suite hook) matches nothing.
 */
export function isAbout(
  line: { file?: string | undefined; test?: string | undefined },
  file: string,
  test: string,
): boolean {
  return (
    line.file === file && typeof line.test === 'string' && line.test !== '' && line.test === test
  );
}
