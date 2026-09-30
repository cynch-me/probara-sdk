/**
 * The identity of a Jest test: the title path and case ids `probara import junit` reads from the
 * name jest-junit gives it with its default templates, and its automation key. The reporter keys
 * each result with it, and the setup file matches each test with the cases of a run with it
 * (`runCasesOnly`): one implementation, so both always agree. Loaded inside the test sandbox too:
 * `@probara/core/metadata` only.
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
  /** Start the key with the test file (jest-junit's `addFileAttribute`). */
  keyIncludesFile: boolean;
  /** The directory the file of a key is relative to: jest-junit's, the working directory. */
  rootDir: string;
  /**
   * The name of the Jest project that ran the test (its `displayName`), which jest-junit fills a
   * `{displayName}` of a title with.
   */
  displayName?: string | undefined;
}

/** The names of a test: its describes, outermost first, and its title. */
export interface JestTestNames {
  ancestorTitles: readonly string[];
  title: string;
}

/** The identity of a test, and the case ids of its titles. */
export interface JestTestIdentity {
  identity: TestIdentity;
  /** The case ids of its describes and title (`SHOP-12`), in order, once each. */
  ids: string[];
}

/** How the JUnit import splits a jest-junit name into the segments of a key. */
const JUNIT_SEPARATOR = ' › ';

/** jest-junit's default `titleTemplate`. */
const JUNIT_TITLE_TEMPLATE = '{classname} {title}';

/**
 * jest-junit's name of a test with its default templates, trimmed like the JUnit import trims it:
 * `{classname} {title}`, the describes joined by spaces, then the title. jest-junit fills the tags
 * one after the other with `String.prototype.replace`, so this does too, in its order: the first
 * occurrence of each tag, `$` patterns expanded (`$$` is `$`, `$&` the tag), and a tag a describe or
 * the title holds filled too. Its `{filepath}`, `{filename}` and `{suitename}` come first, before a
 * describe or a title can hold them: they change nothing in this template.
 */
function nameOf(test: JestTestNames, displayName: string | undefined): string {
  return (
    JUNIT_TITLE_TEMPLATE.replace('{classname}', test.ancestorTitles.join(' '))
      .replace('{title}', test.title)
      // Without a project, jest-junit fills it with `undefined`, as `replace` writes it.
      .replace('{displayName}', String(displayName))
      .trim()
  );
}

/**
 * The identity of the test `test` of the file at `path` (absolute), equal to the one `probara
 * import junit` reads from jest-junit: the describes and the title joined by spaces and split on
 * ` › `, the case ids of the projects it may report to removed from them, and the file with
 * `keyIncludesFile` (jest-junit's `addFileAttribute`).
 */
export function jestTestIdentity(
  path: string,
  test: JestTestNames,
  context: IdentityContext,
): JestTestIdentity {
  const titled = extractTitlePathCaseIds(
    nameOf(test, context.displayName).split(JUNIT_SEPARATOR),
    context.projectCodes,
  );
  return {
    identity: {
      ...(context.keyIncludesFile ? { file: path } : {}),
      titlePath: titled.titlePath,
    },
    ids: titled.ids,
  };
}

/**
 * The automation key of the test `test` of the file at `path`: the one core builds from its
 * identity when it sends the result. `undefined` for a test without a title, which has none.
 */
export function automationKeyOf(
  path: string,
  test: JestTestNames,
  context: IdentityContext,
): string | undefined {
  try {
    return buildAutomationKey(jestTestIdentity(path, test, context).identity, {
      rootDir: context.rootDir,
    });
  } catch {
    return undefined;
  }
}
