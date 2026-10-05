/**
 * The identity of a Cypress test: the title path and case ids `probara import junit` reads from the
 * name cypress-junit gives it, and its automation key. The reporter keys each result with it, and
 * the support file matches each test with the cases of a run with it (`runCasesOnly`): one
 * implementation, so both always agree.
 */
// A type of the main entry, which the declarations resolve without `exports` too; nothing loads.
import type { TestIdentity } from '@probara/core';
import { buildAutomationKey, extractTitlePathCaseIds } from '@probara/core/metadata';

/** What a test's identity depends on besides its names. */
export interface IdentityContext {
  /**
   * The projects whose case ids are read from titles: the configured one, then those of
   * `projects`; none are read without them.
   */
  projectCodes: readonly string[];
  /** Start the key with the spec file (cypress-junit's `file` attribute of the root suite). */
  keyIncludesFile: boolean;
  /** The directory the file of a key is relative to: Cypress's `projectRoot`. */
  rootDir: string;
}

/** The names of a test: the titles of the suites it is in, outermost first, and its own title. */
export interface CypressTestNames {
  suiteTitles: readonly string[];
  title: string;
}

/** The identity of a test, and the case ids of its titles. */
export interface CypressTestIdentity {
  identity: TestIdentity;
  /** The case ids of its suites and title (`SHOP-12`), in order, once each. */
  ids: string[];
}

/**
 * The full title of a test: what `test.fullTitle()` holds, its suite titles and its title joined by
 * spaces, which is exactly what cypress-junit writes as the `name` of the testcase. The reporter
 * builds it itself rather than calling `fullTitle()`: the test of a `retry` event is a serialized
 * clone, where it throws.
 */
export function fullTitleOf(test: CypressTestNames): string {
  return [...test.suiteTitles, test.title].join(' ').trim();
}

/**
 * The identity of the test `test` of the spec at `path`, equal to the one `probara import junit`
 * reads from cypress-junit: the full title as a single segment (cypress-junit joins the titles with
 * spaces, which the import cannot split back into describes), the case ids of the projects it may
 * report to taken out of it, and the spec file with `keyIncludesFile`.
 */
export function cypressTestIdentity(
  path: string,
  test: CypressTestNames,
  context: IdentityContext,
): CypressTestIdentity {
  const titled = extractTitlePathCaseIds([fullTitleOf(test)], context.projectCodes);
  return {
    identity: {
      ...(context.keyIncludesFile ? { file: path } : {}),
      titlePath: titled.titlePath,
    },
    ids: titled.ids,
  };
}

/**
 * The automation key of the test `test` of the spec at `path`: the one core builds from its
 * identity when it sends the result. `undefined` for a test without a title, which has none.
 */
export function automationKeyOf(
  path: string,
  test: CypressTestNames,
  context: IdentityContext,
): string | undefined {
  try {
    return buildAutomationKey(cypressTestIdentity(path, test, context).identity, {
      rootDir: context.rootDir,
    });
  } catch {
    return undefined;
  }
}
