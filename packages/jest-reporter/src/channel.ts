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
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { threadId } from 'node:worker_threads';
// A type of the main entry, which the declarations resolve without `exports` too; nothing loads.
import type { MetadataMessage } from '@probara/core';

/**
 * The environment variable that names the channel directory while the reporter runs. Internal:
 * not a setting (hence not `PROBARA_`).
 */
export const CHANNEL_VARIABLE = '__PROBARA_JEST_CHANNEL';

/** The folder of the channel that holds the copies of attached files. */
export const FILES_FOLDER = 'files';

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
  | { type: 'warning'; message: string; file?: string; test?: string };

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
