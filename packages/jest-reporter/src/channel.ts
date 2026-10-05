/**
 * The channel that carries `probara.*` calls from Jest's test processes (workers, or the main
 * process in band) to the reporter: a private directory the reporter creates before Jest starts
 * its workers and names in {@link CHANNEL_VARIABLE}. Each test process appends one JSON line per
 * call to its own file, synchronously, and copies the files of `probara.attach()` into
 * {@link FILES_FOLDER} at call time. Every line names the test attempt it belongs to, which is how
 * the reporter matches it to Jest's result, whatever the order of Jest's events.
 *
 * The protocol itself (the lines, the run selection and its reader) lives in `@probara/core`, which
 * the Cypress reporter's transport speaks too, and {@link AttemptRef}, {@link ChannelLine} and the
 * rest come from there. What stays here is what Jest needs: the directory, its settings file and the
 * writer of the lines.
 *
 * {@link attemptKey}, {@link SELECTION_FAILURES} and {@link parseSelection} are core's and stay
 * here as well, with the same behavior, because this module loads inside Jest's test sandbox — the
 * helpers (`probara.*`) and the setup file both reach it — where a test file loads Node built-ins,
 * `@probara/core/metadata` at most, and never the reporting library (`test/package.test.ts`). They
 * are kept together with the rest of the protocol: an adapter whose transport is not a Jest sandbox
 * (the Cypress reporter's) uses core's.
 *
 * Loaded in the test sandbox: Node built-ins only.
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { threadId } from 'node:worker_threads';
// Types from the main entry: the declarations resolve without `exports` too (TypeScript's node10
// resolution). Nothing of it loads at run time.
import type { AttemptRef, ChannelLine, RunSelection, SelectionFailure } from '@probara/core';

export type {
  AttemptRef,
  ChannelLine,
  RunSelection,
  SelectionFailure,
  SelectionOutcome,
  StepError,
} from '@probara/core';

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

/** Every {@link SelectionFailure}. */
export const SELECTION_FAILURES: readonly SelectionFailure[] = ['no-hook', 'no-circus', 'failed'];

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
 * The same string for one attempt of one test, in the test process (from Jest's state,
 * `current-test.ts`) and in the reporter (from Jest's results, `channelKeyOf`): the only link
 * between a line and its result. Two tests of one file with the same full name share it; the
 * reporter then gives neither what their helpers said.
 */
export function attemptKey(file: string, test: string, attempt: number): string {
  return JSON.stringify([file, test, attempt]);
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
