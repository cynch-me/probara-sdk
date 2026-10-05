/**
 * The transport that carries `probara.*` calls from a test to the reporter of its framework: one
 * JSON line per call, written by the test side and read by the reporter side, whichever framework
 * carries it (files of a test process, `cy.task` from a browser). Every line names the test attempt
 * it belongs to (the test file, the test's full name and its attempt number), which is how the
 * reporter matches it to the framework's result, whatever the order of its events.
 *
 * The writer and the reader that move those lines around belong to the framework (they need its
 * files and its settings); the protocol itself is here, with {@link detailsOf} to read the lines
 * of one attempt. Nothing here needs `node:fs`.
 */
import type { MetadataMessage } from './metadata.js';

/** The test attempt a line belongs to. */
export interface AttemptRef {
  /** The path of the test file, as the framework's JUnit writer would write it. */
  file: string;
  /** The full name of the test: its suites (or describes) and its title, joined by spaces. */
  test: string;
  attempt: number;
}

/** The error of a failed step. */
export interface StepError {
  message?: string;
  stack?: string;
}

/** One line of the transport. */
export type ChannelLine =
  | (AttemptRef & { type: 'message'; message: MetadataMessage })
  | (AttemptRef & {
      type: 'step-start';
      step: string;
      parent?: string;
      action: string;
      expected?: string;
      data?: string;
    })
  | (AttemptRef & {
      type: 'step-end';
      step: string;
      status: 'passed' | 'failed';
      durationMs: number;
      error?: StepError;
    })
  | (AttemptRef & {
      type: 'attachment';
      /** The step running when the file was attached. */
      step?: string;
      name: string;
      contentType?: string;
      /** The name of the copy the test side wrote; never a path. */
      copy: string;
      /** The base name of the attached file (`{ path }`); none for a body. */
      source?: string;
      /** A body: `text` for a string, `bytes` for bytes. */
      body?: 'text' | 'bytes';
    })
  | { type: 'warning'; message: string; file?: string; test?: string }
  /** The setup file ran in the test file `file`. */
  | { type: 'setup'; file: string }
  /** What the setup file did of `runCasesOnly` in the test file `file`. */
  | ({ type: 'selection'; file: string } & SelectionOutcome);

/**
 * Why the selection of the run could not skip the tests of a file that match no case: the setup
 * file has no hook of the framework to register them in (`no-hook`), no test-runner state to skip
 * them in (`no-circus`: the name is the one on the wire, and the runner state it looks for), or its
 * selection failed (`failed`). A reporter that knows none of them counts the run as not selected.
 */
export type SelectionFailure = 'no-hook' | 'no-circus' | 'failed';

/** Every {@link SelectionFailure}. */
export const SELECTION_FAILURES: readonly SelectionFailure[] = ['no-hook', 'no-circus', 'failed'];

/**
 * What the setup file did of `runCasesOnly` in a test file: it skipped the tests `deselected`
 * (their suites, then their title), which match no case of the run and are not reported; or it
 * skipped none (`reason`), and every test of the file runs.
 */
export type SelectionOutcome =
  { applied: true; deselected: string[][] } | { applied: false; reason: SelectionFailure };

/**
 * The cases of the run `runCasesOnly` runs the tests of, and how a test's key is built, like the
 * reporter builds it.
 */
export interface RunSelection {
  /** The ULID of the run. */
  run: string;
  /** The automation keys of its cases (cases without a key have none here). */
  keys: readonly string[];
  /** The display ids of its cases (`SHOP-12`). */
  caseIds: readonly string[];
  /**
   * The projects whose case ids are read from titles: the configured one, then those of
   * `projects`; none are read without them.
   */
  projectCodes: readonly string[];
  /** Start the key with the test file. */
  keyIncludesFile: boolean;
  /** The directory the file of a key is relative to. */
  rootDir: string;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((each) => typeof each === 'string');
}

/** A {@link RunSelection} read back from the settings the reporter wrote; `undefined` if malformed. */
export function parseSelection(value: unknown): RunSelection | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { run, keys, caseIds, projectCodes, keyIncludesFile, rootDir } = value as Record<
    string,
    unknown
  >;
  if (typeof run !== 'string' || typeof rootDir !== 'string') return undefined;
  if (typeof keyIncludesFile !== 'boolean') return undefined;
  if (!isStringList(keys) || !isStringList(caseIds) || !isStringList(projectCodes)) {
    return undefined;
  }
  return { run, keys, caseIds, projectCodes, keyIncludesFile, rootDir };
}

/**
 * The same string for one attempt of one test, in the test process (from the framework's state) and
 * in the reporter (from the framework's results): the only link between a line and its result. Two
 * tests of one file with the same full name share it; the reporter then gives neither what their
 * helpers said.
 */
export function attemptKey(file: string, test: string, attempt: number): string {
  return JSON.stringify([file, test, attempt]);
}
