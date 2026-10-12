/**
 * What the reporters of a run say about its blob and its attachment copies (V-D4, V-D66, V-D73). Vitest hands the
 * reporter its configured reporters, as the config or the command line names them: a name, a `[name, options]` pair,
 * an instance, or a module path.
 */

/** The reporter of this package, as the config names it. */
const PROBARA_REPORTER = '@probara/vitest-reporter';

/** The reporters Vitest ships whose output is no blob. A run whose reporters are all of these, and ours, writes no blob. */
const SHIPPED_REPORTERS: ReadonlySet<string> = new Set([
  'default',
  'basic',
  'verbose',
  'dot',
  'json',
  'junit',
  'tap',
  'tap-flat',
  'hanging-process',
  'github-actions',
  'html',
  'agent',
  PROBARA_REPORTER,
]);

/** The name of a configured reporter: the entry itself, or the first item of a `[name, options]` pair; `undefined` for an instance. */
function nameOf(reporter: unknown): string | undefined {
  const name: unknown = Array.isArray(reporter) ? (reporter as unknown[])[0] : reporter;
  return typeof name === 'string' ? name : undefined;
}

/** Whether the run writes a blob: the `blob` reporter is configured, by its name alone or with options. */
export function writesBlob(reporters: unknown): boolean {
  return Array.isArray(reporters) && reporters.some((reporter) => nameOf(reporter) === 'blob');
}

/**
 * Whether the run keeps the copies of its `probara.attach()` files (V-D66, V-D73). Only a run whose every reporter is one
 * Vitest ships, or ours, may delete them: an instance, a module path or an unknown name might write a blob, and the
 * merge that reads that blob needs the copies it names (V7 review fix 2). A reporter list that is not a list keeps them.
 */
export function keepsCopiesOf(reporters: unknown): boolean {
  if (!Array.isArray(reporters)) return true;
  return !reporters.every((reporter) => {
    const name = nameOf(reporter);
    return name !== undefined && SHIPPED_REPORTERS.has(name);
  });
}
