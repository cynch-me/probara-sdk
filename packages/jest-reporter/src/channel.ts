/**
 * The channel that carries `probara.*` calls from Jest's test processes (workers, or the main
 * process in band) to the reporter: a private directory the reporter creates before Jest starts
 * its workers and names in {@link CHANNEL_VARIABLE}. Each test process appends one JSON line per
 * call to its own file, synchronously, and copies the files of `probara.attach()` into
 * {@link FILES_FOLDER} at call time. Every line names the test attempt it belongs to (the test
 * file, the test's full name and its attempt number), which is how the reporter matches it to
 * Jest's result, whatever the order of Jest's events. Loaded in the test sandbox: Node built-ins
 * and `@probara/core/metadata` only.
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { threadId } from 'node:worker_threads';
// A type of the main entry, which the declarations resolve without `exports` too; nothing loads.
import type { MetadataMessage } from '@probara/core';
import type { IdentityContext } from './identity.js';

/**
 * The environment variable that names the channel directory while the reporter runs. Internal:
 * not a setting (hence not `PROBARA_`).
 */
export const CHANNEL_VARIABLE = '__PROBARA_JEST_CHANNEL';

/** The folder of the channel that holds the copies of attached files. */
export const FILES_FOLDER = 'files';

/** The file of the channel that holds the reporter's settings for the setup file. */
export const SETTINGS_FILE = 'settings.json';

/** The extension of the files of lines, one per test process (and thread). */
export const LINES_EXTENSION = '.jsonl';

/** The test attempt a line belongs to. */
export interface AttemptRef {
  /** The absolute path of the test file. */
  file: string;
  /** Jest's full name of the test: the describes and the title joined by spaces. */
  test: string;
  attempt: number;
}

/** The error of a failed step. */
export interface StepError {
  message?: string;
  stack?: string;
}

/** One line of the channel. */
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
      /** The name of the copy in {@link FILES_FOLDER}. */
      copy: string;
      /** The base name of the attached file (`{ path }`); none for a body. */
      source?: string;
      /** A body: `text` for a string, `bytes` for bytes. */
      body?: 'text' | 'bytes';
    })
  | { type: 'warning'; message: string; file?: string; test?: string }
  /** The setup file (`@probara/jest-reporter/setup`) runs in the test file `file`. */
  | { type: 'setup'; file: string }
  /** What the setup file did of `runCasesOnly` in the test file `file`. */
  | ({ type: 'selection'; file: string } & SelectionOutcome);

/**
 * Why the setup file could not skip the tests of a file that match no case of the run: no
 * `beforeAll` hook of Jest to register (`no-hook`), no jest-circus state to skip them in
 * (`no-circus`: another test runner), or its selection failed (`failed`).
 */
export type SelectionFailure = 'no-hook' | 'no-circus' | 'failed';

/** Every {@link SelectionFailure}. */
export const SELECTION_FAILURES: readonly SelectionFailure[] = ['no-hook', 'no-circus', 'failed'];

/**
 * What the setup file did of `runCasesOnly` in a test file: it skipped the tests `deselected`
 * (describes, then title), which match no case of the run and are not reported; or it skipped none
 * (`reason`), and every test of the file runs.
 */
export type SelectionOutcome =
  { applied: true; deselected: string[][] } | { applied: false; reason: SelectionFailure };

/**
 * The cases of the run `runCasesOnly` runs the tests of, and how a test's key is built, like the
 * reporter builds it (see `selection.ts`).
 */
export interface RunSelection extends Omit<IdentityContext, 'displayName'> {
  /** The ULID of the run. */
  run: string;
  /** The automation keys of its cases (cases without a key have none here). */
  keys: readonly string[];
  /** The display ids of its cases (`SHOP-12`). */
  caseIds: readonly string[];
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((each) => typeof each === 'string');
}

/** A {@link RunSelection} read back from the channel's settings; `undefined` if malformed. */
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
 * What the reporter tells the setup file (`@probara/jest-reporter/setup`) of every test process:
 * the resolved options it acts on.
 */
export interface ChannelSettings {
  /** Attach each attempt's console output (`captureOutput`). */
  captureOutput: boolean;
  /** Run only the tests of these cases (`runCasesOnly`); every test runs without it. */
  selection?: RunSelection | undefined;
}

/** Writes the settings of the run into the channel, before Jest starts its test processes. */
export function writeSettings(dir: string, settings: ChannelSettings): void {
  writeFileSync(join(dir, SETTINGS_FILE), JSON.stringify(settings));
}

/**
 * The settings of the run the channel `dir` belongs to: every feature off when they cannot be read.
 * Never throws.
 */
export function readSettings(dir: string): ChannelSettings {
  try {
    const settings: unknown = JSON.parse(readFileSync(join(dir, SETTINGS_FILE), 'utf8'));
    if (typeof settings !== 'object' || settings === null) return { captureOutput: false };
    const { captureOutput, selection } = settings as Record<string, unknown>;
    const selected = parseSelection(selection);
    return {
      captureOutput: captureOutput === true,
      ...(selected === undefined ? {} : { selection: selected }),
    };
  } catch {
    return { captureOutput: false };
  }
}

/**
 * The same string for one attempt of one test, in the test process (from Jest's state,
 * `current-test.ts`) and in the reporter (from Jest's results, `channelKeyOf`): the only link
 * between a line and its result. Two tests of one file with the same full name share it; the
 * reporter then gives neither what their helpers said.
 */
export function attemptKey(file: string, test: string, attempt: number): string {
  return JSON.stringify([file, test, attempt]);
}

/** The file this process (and thread: `workerThreads`) appends its lines to. */
export function linesFileOf(dir: string): string {
  return join(dir, `${process.pid}-${threadId}${LINES_EXTENSION}`);
}

/**
 * Appends one line, synchronously: it is written before the test goes on. Throws on failure. It
 * writes with the `fs` of the test's module registry: a test file that mocks `fs`
 * (`jest.mock('fs')`) silences it, and its helper calls never reach the reporter.
 */
export function appendLine(dir: string, line: ChannelLine): void {
  appendFileSync(linesFileOf(dir), `${JSON.stringify(line)}\n`);
}

/**
 * Attaches `text` to the attempt `ref`: writes it into {@link FILES_FOLDER}, then appends its line.
 * Throws on failure.
 */
export function attachText(
  dir: string,
  ref: AttemptRef,
  attachment: { name: string; contentType: string; text: string },
): void {
  const copy = randomUUID();
  writeFileSync(join(dir, FILES_FOLDER, copy), attachment.text);
  appendLine(dir, {
    ...ref,
    type: 'attachment',
    name: attachment.name,
    contentType: attachment.contentType,
    copy,
    body: 'text',
  });
}
