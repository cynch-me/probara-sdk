/**
 * The console output of an attempt, as the Jest reporter attaches it (V-D9): what the attempt wrote to stdout and to
 * stderr, in the order it was written, cut as core cuts an attachment, as `stdout.log` and `stderr.log` (`text/plain`),
 * each only when it has text. Reporter side only: the worker never loads it.
 */
import {
  appendOutput,
  CUT_MARKER,
  emptyStreamOutput,
  MAX_OUTPUT_BYTES,
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

/** The bytes of a text in UTF-8. */
function bytesOf(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The room a stream keeps back for its cut line: the line itself, and the line break before it when the text does not
 * end with one (V7 review fix 1). What is kept of a stream never takes that room, so the attachment of a cut stream is
 * the text kept, then the line, within core's cap.
 */
const CUT_ROOM = bytesOf(CUT_MARKER) + 1;

/**
 * The console logs of one test, kept until the run ends, in the order they were written (V-D9, V7 review fix 1). Each
 * stream holds at most one attachment's worth of text, so the memory a run keeps for the output of its tests stays
 * bounded: a stream that overflows keeps what fits, then the cut line, and nothing more. Core's cut rule, per stream.
 */
export class ConsoleKeeper {
  /** The logs kept, in the order they were written, both streams together. */
  readonly entries: ConsoleEntry[] = [];
  private readonly bytes: Record<ConsoleEntry['type'], number> = { stdout: 0, stderr: 0 };
  private readonly cut: Record<ConsoleEntry['type'], boolean> = { stdout: false, stderr: false };

  /** Keeps a log of the test, unless its stream was cut already. Never throws. */
  add({ type, content, time }: ConsoleEntry): void {
    if (this.cut[type]) return;
    const limit = MAX_OUTPUT_BYTES - CUT_ROOM;
    const size = bytesOf(content);
    if (this.bytes[type] + size <= limit) {
      this.entries.push({ type, content, time });
      this.bytes[type] += size;
      return;
    }
    // The whole characters that fit in the room left, then the cut line on a line of its own.
    const room = new Uint8Array(Math.max(limit - this.bytes[type], 0));
    const { read } = new TextEncoder().encodeInto(content, room);
    const head = content.slice(0, read);
    const kept = `${head}${head === '' || head.endsWith('\n') ? '' : '\n'}${CUT_MARKER}`;
    this.entries.push({ type, content: kept, time });
    this.bytes[type] += bytesOf(kept);
    this.cut[type] = true;
  }
}
