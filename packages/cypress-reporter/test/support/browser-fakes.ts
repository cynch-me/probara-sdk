/**
 * A fake of the browser a Cypress spec runs in: the `Cypress` object, the `cy` chain, the root
 * hooks of the spec, the `console` of the frame and the global the support file publishes the
 * helpers on.
 *
 * The chain is the part that matters: Cypress runs what a command queues before the test goes on,
 * so `cy.task(…)` records its payload here and resolves with the answer the plugin gave it,
 * `cy.readFile(path, 'base64')` resolves with the base64 of a file of {@link FakeBrowser.files},
 * and `cy.then(…)` queues a callback that {@link FakeBrowser.flush} runs, in order, like Cypress
 * runs the commands of a test.
 */
import type {
  BrowserConsole,
  CypressBrowser,
  CypressChain,
  Probara,
  SupportContext,
  SupportHooks,
} from '../../src/support-api.js';

/** One `cy.task('probara', …)`, and whether it was kept out of the Cypress log. */
export interface SentTask {
  name: string;
  payload: unknown;
  log: boolean | undefined;
}

/** What a task the browser sent carried: its kind, and its line (or its question). */
export interface SentPayload {
  kind: string;
  line?: Record<string, unknown>;
  base64?: string;
  text?: string;
  titlePath?: string[];
  file?: string;
}

export interface FakeBrowser {
  /** The context the support file takes everything it needs from. */
  context: SupportContext;
  /** Every task a helper sent, in order. */
  sent: SentTask[];
  /** What each task carried, in order. */
  payloads(): SentPayload[];
  /** The lines of the transport, in order (a `select` carries none). */
  lines(): Record<string, unknown>[];
  /** The `console` of the frame, whose methods the capture wraps. */
  console: BrowserConsole & Record<string, unknown>;
  /** Everything written with the console since the fake made it, in order. */
  written: string[];
  /** The warnings the support file logged on the console itself. */
  warnings: string[];
  /** The tests whose root `beforeEach` called `this.skip()`, as their title paths. */
  skipped: string[][];
  /** The helpers the support file published. */
  helpers(): Probara;
  /** What the plugin exposed only now, as one that wrote `config.expose` after the frame loaded. */
  reveal(): void;
  /** Runs every root `before` of the spec. */
  before(): void;
  /** Runs every root `beforeEach`, with `currentTest` the test that is about to run. */
  beforeEach(titlePath?: readonly string[]): void;
  /** Runs every root `afterEach`. */
  afterEach(): void;
  /** Runs what `cy.then` and every other command queued, the way Cypress runs a test's commands. */
  flush(): void;
  /** Makes `Cypress.currentTest` hold nothing in a root `afterEach`, as a Cypress would not. */
  forgetCurrentTestInAfterEach(): void;
  /** The test the browser frame names now, as `Cypress.currentTest.titlePath`. */
  currentTest(): readonly string[] | undefined;
}

/** What the plugin exposes to a run that has one. */
export function settingsOf(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { version: '0.1.0', captureOutput: false, ...extra };
}

export function fakeBrowser({
  settings,
  revealLater,
  files = {},
  answer,
}: {
  /** What `Cypress.expose('probara')` reads back; `undefined` for a run with no plugin. */
  settings?: unknown;
  /**
   * What `Cypress.expose('probara')` reads back only after {@link FakeBrowser.reveal}: a plugin that
   * filled `config.expose` after the support file had loaded, and the reason the helpers must not
   * decide they are off at load time.
   */
  revealLater?: unknown;
  /** The files `cy.readFile` reads: path → its content, as the bytes are turned into base64. */
  files?: Record<string, string>;
  /** The plugin's answer to a task, by its payload. */
  answer?: (payload: unknown) => unknown;
} = {}): FakeBrowser {
  const sent: SentTask[] = [];
  const written: string[] = [];
  const warnings: string[] = [];
  let revealed = false;
  const hooks: { before: (() => void)[]; beforeEach: (() => void)[]; afterEach: (() => void)[] } = {
    before: [],
    beforeEach: [],
    afterEach: [],
  };
  const browser: CypressBrowser = {
    spec: { relative: 'cypress/e2e/cart.cy.js' },
    currentTest: undefined,
    expose: (key: string) =>
      key === 'probara' ? (revealed ? (revealLater ?? settings) : settings) : undefined,
  };
  const console_: BrowserConsole & Record<string, unknown> = {
    log: (...args: unknown[]) => written.push(`log: ${args.map(String).join(' ')}`),
    info: (...args: unknown[]) => written.push(`info: ${args.map(String).join(' ')}`),
    debug: (...args: unknown[]) => written.push(`debug: ${args.map(String).join(' ')}`),
    warn: (...args: unknown[]) => written.push(`warn: ${args.map(String).join(' ')}`),
    error: (...args: unknown[]) => written.push(`error: ${args.map(String).join(' ')}`),
  };
  /** What the commands of the chain queued, in order: what `flush` runs. */
  const queued: (() => void)[] = [];
  /** The subject the last command resolved with, like Cypress's chain. */
  let subject: unknown;
  let published: Probara | undefined;
  let clock = 1_000;
  let forgetAfterEach = false;

  const chain: CypressChain = {
    task(name, payload, options) {
      sent.push({ name, payload, log: options?.log });
      queued.push(() => {
        subject = answer === undefined ? undefined : answer(payload);
      });
      return chain;
    },
    then(callback) {
      queued.push(() => {
        subject = callback(subject);
      });
      return chain;
    },
    readFile(path, encoding) {
      queued.push(() => {
        const content = files[path];
        if (content === undefined) throw new Error(`cy.readFile could not read "${path}"`);
        // The browser asks for the base64 of a file, and this fake only holds files as text.
        const base64: Readonly<Record<string, (text: string) => string>> = { base64: btoa };
        subject = base64[encoding]?.(content) ?? content;
      });
      return chain;
    },
  };

  const context: SupportContext = {
    cypress: () => browser,
    cy: () => chain,
    hooks: (): SupportHooks => ({
      before: (fn) => hooks.before.push(fn),
      beforeEach: (fn) => hooks.beforeEach.push(fn),
      afterEach: (fn) => hooks.afterEach.push(fn),
    }),
    console: () => console_,
    warn: (message) => warnings.push(message),
    now: () => (clock += 5),
    uuid: () => `step-${String(clock)}`,
    publish: (given) => {
      published = given;
    },
  };

  const fake: FakeBrowser = {
    context,
    sent,
    console: console_,
    written,
    warnings,
    skipped: [],
    payloads: () => sent.map((each) => each.payload as SentPayload),
    lines: () =>
      sent.map((each) => (each.payload as SentPayload).line).filter((line) => line !== undefined),
    helpers: () => {
      if (published === undefined) throw new Error('the support file published nothing');
      return published;
    },
    reveal: () => {
      revealed = true;
    },
    before: () => {
      for (const fn of hooks.before) fn();
    },
    beforeEach: (titlePath) => {
      browser.currentTest = { titlePath: [...(titlePath ?? ['Cart', 'adds an item'])] };
      // Mocha's own context of a hook: `this.skip()` is how a `beforeEach` skips its test.
      for (const fn of hooks.beforeEach)
        fn.call({
          skip: () => {
            fake.skipped.push([...(titlePath ?? ['Cart', 'adds an item'])]);
          },
        });
    },
    afterEach: () => {
      for (const fn of hooks.afterEach) fn();
      if (forgetAfterEach) browser.currentTest = undefined;
    },
    flush: () => {
      while (queued.length > 0) (queued.shift() as () => void)();
    },
    forgetCurrentTestInAfterEach: () => {
      forgetAfterEach = true;
    },
    currentTest: () => browser.currentTest?.titlePath,
  };
  return fake;
}
