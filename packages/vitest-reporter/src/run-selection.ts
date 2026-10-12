/**
 * The run selection of a Vitest run (`runCasesOnly`, V-D15): the cases of the run, which the reporter reads before the
 * workers run, the value it provides to each project, and the rule that decides a test with it. The setup file decides
 * in each worker, and the reporter leaves the same tests out of the report, with this one module, so the two never
 * disagree. Loads `@probara/core` (its main entry, for the matcher) and `./identity.js`; the reporter process loads it too.
 */
import { createRunSelector, type RunCases } from '@probara/core';
import { automationKeyOf, junitNameOf, vitestIdentity, type IdentityContext } from './identity.js';

/** The provided key of a run's selection. Its value is the selection as JSON, or `''` when the run selects nothing. */
export const SELECTION_KEY = 'probaraRunSelection' as const;

declare module 'vitest' {
  interface ProvidedContext {
    /** The cases of the run `runCasesOnly` takes its tests from, as JSON (see `run-selection.ts`); `''` for none. */
    probaraRunSelection: string;
  }
}

/** The cases of the run a selection takes its tests from, and the names' rules that match a test to them. */
export interface RunCaseSelection extends RunCases {
  /** The run whose cases these are: its ULID. */
  run: string;
  /** The configured project codes, whose case ids are read from the titles (`projectCodes`). */
  projectCodes: string[];
  /** Whether an automation key starts with the test file (`keyIncludesFile`). */
  keyIncludesFile: boolean;
  /** The directory the file of a key is relative to: the Vitest root. */
  rootDir: string;
}

/** Whether a test belongs to the cases of a run, given its file (absolute), its describes (outermost first) and its title. */
export type TestSelector = (file: string, ancestors: readonly string[], title: string) => boolean;

/** The value the reporter provides for `selection`: its JSON, or `''` when the run selects nothing. */
export function selectionValue(selection: RunCaseSelection | undefined): string {
  return selection === undefined ? '' : JSON.stringify(selection);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((each) => typeof each === 'string');
}

/**
 * The selection a provided value carries. `undefined` for a missing or an empty value, and for one that is not a
 * selection, so every test of the run runs then, as the reporter says.
 */
export function selectionOf(value: unknown): RunCaseSelection | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const fields = parsed as Record<string, unknown>;
  const valid =
    typeof fields.run === 'string' &&
    isStrings(fields.keys) &&
    isStrings(fields.caseIds) &&
    isStrings(fields.projectCodes) &&
    typeof fields.keyIncludesFile === 'boolean' &&
    typeof fields.rootDir === 'string';
  return valid ? (parsed as RunCaseSelection) : undefined;
}

/** What the selection matches a test by: the case ids its names hold, and its automation key, read as its result is keyed. */
function selectableOf(
  file: string,
  ancestors: readonly string[],
  title: string,
  context: IdentityContext,
) {
  const name = junitNameOf(ancestors, title);
  return {
    ids: vitestIdentity(file, name, context).ids,
    key: automationKeyOf(file, name, context),
  };
}

/** The selector of a run's selection: one rule, read the same way in the worker and in the reporter. */
export function createTestSelector(selection: RunCaseSelection): TestSelector {
  const selects = createRunSelector(selection);
  const context: IdentityContext = {
    projectCodes: selection.projectCodes,
    keyIncludesFile: selection.keyIncludesFile,
    rootDir: selection.rootDir,
  };
  return (file, ancestors, title) => selects(selectableOf(file, ancestors, title, context));
}
