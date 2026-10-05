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
 *    the `reporterOptions` of the config.
 * 2. **What the plugin reads**: `config.reporterOptions` itself.
 *
 * and either may be the plain object, or the wrapper a multi-reporter builds: one key, the name of
 * the reporter, and the user's options inside it
 * (`{ '@probara/cypress-reporter': { projectId: 'SHOP' } }`). An object with any other single key
 * is another reporter's wrapper and is left as it is.
 *
 * Node-free, like every module both processes load.
 */

/** The key a wrapper of this package has: the single key that holds the user's options. */
const WRAPPER_PREFIX = '@probara/';

/**
 * The user's options in the object a wrapper holds: the value of its single key when that key is
 * one of this package's names, the object itself in every other case. Anything that is not an
 * object (`null`, a number, a string) is returned as it is, and the caller decides what that means.
 */
export function probaraOptionsOf(given: unknown): unknown {
  if (typeof given !== 'object' || given === null) return given;
  const keys = Object.keys(given);
  const wrapped = keys.length === 1 ? keys[0] : undefined;
  return wrapped?.startsWith(WRAPPER_PREFIX) === true
    ? (given as Record<string, unknown>)[wrapped]
    : given;
}

/**
 * The options of the run, out of what Cypress hands a reporter: the `reporterOptions` of its
 * envelope, or the options themselves when Cypress passed them without one, unwrapped from a
 * multi-reporter's wrapper by {@link probaraOptionsOf}.
 */
export function reporterOptionsOf(options: unknown): unknown {
  if (typeof options !== 'object' || options === null) return options;
  const { reporterOptions } = options as { reporterOptions?: unknown };
  const inner = reporterOptions === undefined ? options : reporterOptions;
  return probaraOptionsOf(inner);
}
