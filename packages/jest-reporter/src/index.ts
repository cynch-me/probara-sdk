/**
 * `@probara/jest-reporter`: `module.exports` is the reporter class, which Jest instantiates with
 * `new Reporter(globalConfig, options, context)`, and `import Reporter from` gives in an ES module.
 * Its `probara` property holds the helpers a test file requires
 * (`const { probara } = require('@probara/jest-reporter')`, `import { probara } from`).
 *
 * A test file loads this entry inside Jest's module registry, once per file: it only loads the
 * helpers (Node built-ins and `@probara/core/metadata`). The reporter itself, and the reporting
 * library with its HTTP client, load when Jest creates the reporter.
 */
import type { JestAttempt, JestCaseStart, JestFileResult, JestTest } from './jest.js';
import type { ProbaraJestOptions as Options } from './options.js';
import {
  probara as helpers,
  type Probara as Helpers,
  type ProbaraAttachment as Attachment,
  type ProbaraStepOptions as StepOptions,
  type ProbaraValues as Values,
} from './probara.js';
import type { ProbaraJestReporter as Implementation } from './reporter.js';

/**
 * The reporter of each instance: in a map rather than a field, so neither a subclass's own fields
 * nor a consumer's TypeScript target (a `#private` field needs ES2015) ever meet it.
 */
const reporters = new WeakMap<object, Implementation>();

/** The reporter of `instance`. */
function reporterOf(instance: object): Implementation {
  const reporter = reporters.get(instance);
  if (reporter === undefined) throw new TypeError('Not a ProbaraJestReporter');
  return reporter;
}

/**
 * Sends every test result of a Jest run to Probara. Register it in the Jest config:
 * `reporters: ['default', ['@probara/jest-reporter', { projectId: 'SHOP' }]]`. It never throws into
 * Jest and never changes Jest's exit code: reporting failures are logged on stderr.
 *
 * Each hook hands the event to the reporter, which loads when Jest creates this class (never when a
 * test file loads the helpers): a hook the reporter gains needs its forward here too, which
 * `test/package.test.ts` checks. A class extending it overrides any hook and calls `super`.
 */
class ProbaraJestReporter {
  /** The `probara.*` helpers of the running test. */
  static readonly probara: Helpers = helpers;

  /** Jest calls it with its global config and the reporter options (and a context it needs not). */
  constructor(globalConfig?: unknown, options?: Options) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only when Jest needs it.
    const reporter = require('./reporter.js') as typeof import('./reporter.js');
    reporters.set(this, new reporter.ProbaraJestReporter(globalConfig, options));
  }

  onRunStart(): Promise<void> {
    return reporterOf(this).onRunStart();
  }

  onTestFileStart(test: JestTest): void {
    reporterOf(this).onTestFileStart(test);
  }

  onTestCaseStart(test: JestTest, start: JestCaseStart): void {
    reporterOf(this).onTestCaseStart(test, start);
  }

  onTestCaseResult(test: JestTest, attempt: JestAttempt): void {
    reporterOf(this).onTestCaseResult(test, attempt);
  }

  onTestFileResult(test: JestTest, result: JestFileResult): void {
    reporterOf(this).onTestFileResult(test, result);
  }

  onRunComplete(): Promise<void> {
    return reporterOf(this).onRunComplete();
  }

  getLastError(): Error | undefined {
    return reporterOf(this).getLastError();
  }
}

/**
 * The types that come with the reporter class: `require('@probara/jest-reporter')` is the class
 * itself (what Jest instantiates), so the types of its options and helpers travel on it.
 */
// eslint-disable-next-line @typescript-eslint/no-namespace -- types only: nothing is emitted.
declare namespace ProbaraJestReporter {
  export type ProbaraJestOptions = Options;
  export type Probara = Helpers;
  export type ProbaraAttachment = Attachment;
  export type ProbaraStepOptions = StepOptions;
  export type ProbaraValues = Values;
}

export = ProbaraJestReporter;

// For `import { probara } from '@probara/jest-reporter'` in an ES module: Node's CommonJS lexer
// (and Jest's) reads a named export in this form only. The value importers get is the class's own
// `probara`, the same helpers (TypeScript emits `module.exports = ProbaraJestReporter` last).
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- `module.exports` is `any`.
module.exports.probara = helpers;
