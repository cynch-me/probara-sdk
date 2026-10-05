/**
 * `@probara/cypress-reporter`: `module.exports` is the reporter class, which Cypress instantiates
 * with `new Reporter(runner, options)` for each spec, and `import Reporter from` gives in an ES
 * module. Its `probara` property holds nothing: the `probara.*` helpers of a test are the browser
 * side, in `@probara/cypress-reporter/support`.
 *
 * The support file of a project loads only `@probara/cypress-reporter/support`, never this entry:
 * the reporting library loads with the reporter, when Cypress creates it.
 */
import type {
  CypressMochaEvent,
  CypressMochaEvents,
  CypressMochaRunner,
  CypressRunnable,
  CypressSuite,
  CypressTest,
} from './cypress.js';
import { MOCHA_EVENTS } from './cypress.js';
import type { ProbaraCypressOptions as Options } from './options.js';
import { ProbaraCypressReporter as Implementation } from './reporter.js';

/** The reporter of each instance: in a map, so no consumer's TypeScript target ever meets it. */
const reporters = new WeakMap<object, Implementation>();

/** The reporter of `instance`. */
function reporterOf(instance: object): Implementation {
  const reporter = reporters.get(instance);
  if (reporter === undefined) throw new TypeError('Not a ProbaraCypressReporter');
  return reporter;
}

/** What Cypress hands the reporter: the runner of a spec, and the options of the Cypress config. */
interface CypressReporterOptions {
  /** `reporterOptions` of the Cypress config, as the user wrote it. */
  reporterOptions?: unknown;
}

/**
 * Sends every test result of a Cypress run to Probara. Register it in the Cypress config:
 * `reporter: '@probara/cypress-reporter'` with
 * `reporterOptions: { projectId: 'SHOP' }`, and add `setupNodeEvents` from
 * `@probara/cypress-reporter/setup`. It never throws into Cypress and never changes its exit code:
 * reporting failures are logged on stderr.
 *
 * Each hook hands the event to the reporter, which loads when Cypress creates this class. A hook
 * the reporter gains needs its forward here too, which `test/package.test.ts` checks.
 */
class ProbaraCypressReporter {
  /** Cypress calls it with the runner of one spec and the reporter options. */
  constructor(runner?: CypressMochaRunner, options?: CypressReporterOptions) {
    try {
      reporters.set(this, new Implementation(runner, options));
      // Cypress instantiates the reporter and never calls a hook of it: the reporter follows the
      // runner. Each hook of this class hands its event to the reporter that is loaded above.
      if (runner !== undefined) follow(runner, this);
    } catch {
      // A reporter must never break the run: nothing is reported, and the log says why.
      console.error(
        '[probara] Probara reporting is off: the reporter could not be loaded; reinstall @probara/cypress-reporter',
      );
    }
  }

  start(): void {
    reporterOf(this).start();
  }

  suite(suite: CypressSuite): void {
    reporterOf(this).suite(suite);
  }

  'suite end'(suite: CypressSuite): void {
    reporterOf(this)['suite end'](suite);
  }

  test(test: CypressTest): void {
    reporterOf(this).test(test);
  }

  hook(): void {
    reporterOf(this).hook();
  }

  'hook end'(): void {
    reporterOf(this)['hook end']();
  }

  pass(runnable: CypressRunnable): void {
    reporterOf(this).pass(runnable);
  }

  fail(runnable: CypressRunnable, error: Error): void {
    reporterOf(this).fail(runnable, error);
  }

  pending(runnable: CypressRunnable): void {
    reporterOf(this).pending(runnable);
  }

  'test end'(): void {
    reporterOf(this)['test end']();
  }

  retry(runnable: CypressRunnable, error: Error): void {
    reporterOf(this).retry(runnable, error);
  }

  end(): void {
    reporterOf(this).end();
  }
}

/** Every Mocha event the reporter follows, and the handler the class exposes for each of them. */
type Hooks = { [E in CypressMochaEvent]: (...args: CypressMochaEvents[E]) => void };

/** Hands every Mocha event of `runner` to the hook of `reporter` named after it. */
function follow(runner: CypressMochaRunner, reporter: Hooks): void {
  const hooks = reporter as unknown as Record<CypressMochaEvent, (...args: unknown[]) => void>;
  const on = runner.on.bind(runner) as unknown as (
    event: CypressMochaEvent,
    handler: (...args: never[]) => void,
  ) => void;
  for (const event of MOCHA_EVENTS) {
    const hook = hooks[event];
    if (typeof hook !== 'function') continue;
    on(event, (...args: never[]) => {
      try {
        // Called with the instance: a hook of this class reaches its reporter through it.
        hook.apply(reporter, args);
      } catch (error) {
      }
    });
  }
}

/**
 * The types that come with the reporter class: `require('@probara/cypress-reporter')` is the class
 * itself (what Cypress instantiates), so the types of its options travel on it.
 */
// eslint-disable-next-line @typescript-eslint/no-namespace -- types only: nothing is emitted.
declare namespace ProbaraCypressReporter {
  export type ProbaraCypressOptions = Options;
  export type ProbaraCypressReporterOptions = CypressReporterOptions;
}

export = ProbaraCypressReporter;