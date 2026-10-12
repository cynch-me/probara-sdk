/**
 * The identity of a Vitest test: the title path and case ids that `probara import junit` reads from
 * the name Vitest's JUnit writer gives it (`ancestorSeparator` ` > `, the default), and its
 * automation key. The reporter keys each result with it. Loaded in the test process too, later
 * (the setup file matches a test with the cases of a run): `@probara/core/metadata` only.
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
  /** Start the key with the test file (the JUnit writer's `addFileAttribute`). */
  keyIncludesFile: boolean;
  /** The directory the file of a key is relative to: the Vitest root. */
  rootDir: string;
}

/** The separator Vitest's JUnit writer puts between the describes of a test and its title. */
const SEPARATOR = ' > ';

/** The name Vitest's JUnit writer gives a test: its describes, then its title, joined by ` > `. */
export function junitNameOf(ancestors: readonly string[], title: string): string {
  return [...ancestors, title].join(SEPARATOR);
}

/** The identity of one test, and the case ids its name holds (`PRB-12`), in order, once each. */
export interface VitestIdentity {
  identity: TestIdentity;
  ids: string[];
}

/**
 * The identity of the test `name` (its JUnit name, see {@link junitNameOf}) of the file at `file`
 * (absolute). The name is split and read like the JUnit import reads it, so the key is the same
 * for every test whichever way the report came, including a title that holds ` > `.
 */
export function vitestIdentity(
  file: string,
  name: string,
  context: IdentityContext,
): VitestIdentity {
  const titled = extractTitlePathCaseIds(name.split(SEPARATOR), context.projectCodes);
  return {
    identity: {
      ...(context.keyIncludesFile ? { file } : {}),
      titlePath: titled.titlePath,
    },
    ids: titled.ids,
  };
}

/**
 * The automation key of the test `name` of the file at `file`: the one core builds from its
 * identity when it sends the result. `undefined` for a name with no title, which has none.
 */
export function automationKeyOf(
  file: string,
  name: string,
  context: IdentityContext,
): string | undefined {
  try {
    return buildAutomationKey(vitestIdentity(file, name, context).identity, {
      rootDir: context.rootDir,
    });
  } catch {
    return undefined;
  }
}
