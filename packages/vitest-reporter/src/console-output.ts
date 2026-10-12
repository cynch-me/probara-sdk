/**
 * The console output of an attempt, as the Jest reporter attaches it (V-D9): what the attempt wrote to stdout and to
 * stderr, in the order it was written, cut as core cuts an attachment, as `stdout.log` and `stderr.log` (`text/plain`),
 * each only when it has text. Reporter side only: the worker never loads it.
 */
import {
  appendOutput,
  emptyStreamOutput,
  type AttachmentInput,
  type StreamOutput,
} from '@probara/core';
import type { ConsoleEntry } from './attempts.js';

/** The attachments of the console output of an attempt: `stdout.log`, then `stderr.log`, each only with text. */
export function outputAttachmentsOf(entries: readonly ConsoleEntry[]): AttachmentInput[] {
  const streams: Record<ConsoleEntry['type'], StreamOutput> = {
    stdout: emptyStreamOutput(),
    stderr: emptyStreamOutput(),
  };
  for (const { type, content } of entries) appendOutput(streams[type], content);
  return (['stdout', 'stderr'] as const).flatMap((type): AttachmentInput[] => {
    const output = streams[type];
    if (output.bytes === 0) return [];
    return [
      { name: `${type}.log`, body: Buffer.from(output.text, 'utf8'), contentType: 'text/plain' },
    ];
  });
}
