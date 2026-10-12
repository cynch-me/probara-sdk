/**
 * The console output one test attempt writes to one stream, kept within what an attachment holds:
 * {@link appendOutput} takes what the stream writes and cuts it at {@link MAX_OUTPUT_BYTES}, at a
 * whole character, with the line {@link CUT_MARKER}. Pure, so a Cypress support file (a browser
 * frame) captures with it through `@probara/core/browser`. The Jest reporter's test sandbox keeps a
 * copy of it: that sandbox may load no file of core (see `jest-reporter/src/capture-output.ts`).
 */
import { MAX_ATTACHMENT_BYTES } from './limits.js';

/** The most a stream's attachment holds, in bytes: core's `MAX_ATTACHMENT_BYTES`. */
export const MAX_OUTPUT_BYTES = MAX_ATTACHMENT_BYTES;

/** The last line of an output cut at {@link MAX_OUTPUT_BYTES}: the Jest reporter's own. */
export const CUT_MARKER =
  '[probara] The output of this test was cut here: an attachment holds at most 32 MiB\n';

/** What one stream of an attempt recorded: its text, its size in UTF-8 bytes, and whether it is cut. */
export interface StreamOutput {
  text: string;
  bytes: number;
  full: boolean;
}

/** The output of a stream nothing was recorded on yet. */
export function emptyStreamOutput(): StreamOutput {
  return { text: '', bytes: 0, full: false };
}

/**
 * `text` added to `output`, up to {@link MAX_OUTPUT_BYTES}: what would go beyond is cut at a whole
 * character and ends with {@link CUT_MARKER}. Nothing is added after a cut.
 */
export function appendOutput(output: StreamOutput, text: string): void {
  if (output.full) return;
  const encoder = new TextEncoder();
  const size = encoder.encode(text).length;
  if (output.bytes + size <= MAX_OUTPUT_BYTES) {
    output.text += text;
    output.bytes += size;
    return;
  }
  // Room for the marker on a line of its own.
  const room = new Uint8Array(MAX_OUTPUT_BYTES - encoder.encode(CUT_MARKER).length - 1);
  const whole = output.text + text;
  // `read` counts UTF-16 units and never ends inside a character.
  const { read } = encoder.encodeInto(whole, room);
  const kept = whole.slice(0, read);
  output.text = `${kept}${kept.endsWith('\n') ? '' : '\n'}${CUT_MARKER}`;
  output.bytes = encoder.encode(output.text).length;
  output.full = true;
}
