/**
 * How the user's reporter options are read, in ONE implementation, because the reporter process and
 * the plugin process are two: both resolve the options of the same run, and a difference between
 * them would leave one of the two with settings the other has (measured: with the wrapper unwrapped
 * in one process and read raw in the other, the reporter sends every result and the run that owns
 * them reports nothing).
 *
 * Two shapes reach the two processes, and both are read here:
 *
 * 1. **What Cypress hands the reporter**: `{ reporterOptions }`, the envelope Cypress builds around
 *    the `reporterOptions` of the config. `cypress-multi-reporters` builds the same envelope around
 *    this reporter's own options, already picked out of its configuration.
 * 2. **What the plugin reads**: `config.reporterOptions` itself, which is the user's options, or the
 *    whole configuration of `cypress-multi-reporters` when the config registers this reporter
 *    through it (`reporterEnabled`, and this reporter's options under {@link MULTI_REPORTERS_KEY}).
 *
 * Node-free, like every module both processes load.
 */

/**
 * The key `cypress-multi-reporters` reads this reporter's options from: `_.camelCase(name)` followed
 * by `ReporterOptions` (its `getReporterOptions`, 2.0.5), for the name `@probara/cypress-reporter`.
 */
export const MULTI_REPORTERS_KEY = 'probaraCypressReporterReporterOptions';

/** The key that names the reporters of a `cypress-multi-reporters` configuration. */
const MULTI_REPORTERS_ENABLED = 'reporterEnabled';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The user's options in `config.reporterOptions`: the object itself, or, for a configuration of
 * `cypress-multi-reporters`, the options it hands this reporter (its common `reporterOptions`, then
 * {@link MULTI_REPORTERS_KEY} over them, as it merges them). Anything that is not an object (`null`,
 * a number, a string) is returned as it is, and the caller decides what that means.
 */
export function probaraOptionsOf(given: unknown): unknown {
  if (!isObject(given)) return given;
  if (!(MULTI_REPORTERS_KEY in given) && !(MULTI_REPORTERS_ENABLED in given)) return given;
  const common = given['reporterOptions'];
  const own = given[MULTI_REPORTERS_KEY];
  return { ...(isObject(common) ? common : {}), ...(isObject(own) ? own : {}) };
}

/**
 * The options of the run, out of what Cypress hands a reporter: the `reporterOptions` of its
 * envelope, or the options themselves when Cypress passed them without one, read by
 * {@link probaraOptionsOf}.
 */
export function reporterOptionsOf(options: unknown): unknown {
  if (typeof options !== 'object' || options === null) return options;
  const { reporterOptions } = options as { reporterOptions?: unknown };
  const inner = reporterOptions === undefined ? options : reporterOptions;
  return probaraOptionsOf(inner);
}
