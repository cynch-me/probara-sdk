/**
 * What a test's console output becomes: the text of one stream of an attempt, kept within what an
 * attachment holds, cut at a whole character with a last line that says so.
 */
import { describe, expect, it } from 'vitest';
import { appendOutput, CUT_MARKER, emptyStreamOutput, MAX_OUTPUT_BYTES } from './output-capture.js';

/** The UTF-8 size of `text`, as the attachment is measured. */
function bytesOf(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe('the output of one stream of an attempt', () => {
  it('is capped at the size of an attachment, with the line that says it was cut', () => {
    expect(MAX_OUTPUT_BYTES).toBe(32 * 1024 * 1024);
    expect(CUT_MARKER).toBe(
      '[probara] The output of this test was cut here: an attachment holds at most 32 MiB\n',
    );
  });

  it('records what it is given, counting its bytes, and is not full', () => {
    const output = emptyStreamOutput();

    appendOutput(output, 'first\n');
    appendOutput(output, 'é second\n');
    appendOutput(output, '');

    expect(output).toEqual({
      text: 'first\né second\n',
      bytes: bytesOf('first\né second\n'),
      full: false,
    });
  });

  it('keeps a text that ends exactly at the cap, and cuts what comes after it', () => {
    const output = emptyStreamOutput();

    appendOutput(output, 'x'.repeat(MAX_OUTPUT_BYTES));
    expect(output).toMatchObject({ bytes: MAX_OUTPUT_BYTES, full: false });

    appendOutput(output, 'y\n');
    expect(output.full).toBe(true);
    expect(output.text.endsWith(CUT_MARKER)).toBe(true);
    // The kept text and the marker fill the cap exactly: one line of its own, never more.
    expect(output.bytes).toBe(MAX_OUTPUT_BYTES);
    expect(bytesOf(output.text)).toBe(MAX_OUTPUT_BYTES);
  });

  it('cuts at a whole character, never inside one', () => {
    const output = emptyStreamOutput();

    // A two-byte character, more of them than the cap holds: the cut may fall on half of one.
    appendOutput(output, 'é'.repeat(MAX_OUTPUT_BYTES));

    expect(output.full).toBe(true);
    expect(output.text).not.toContain('�');
    expect(output.text.endsWith(CUT_MARKER)).toBe(true);
    expect(output.bytes).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect(output.bytes).toBe(bytesOf(output.text));
  });

  it('adds no line break before the marker when the kept text already ends one', () => {
    const output = emptyStreamOutput();
    const room = MAX_OUTPUT_BYTES - bytesOf(CUT_MARKER) - 1;
    const kept = `${'x'.repeat(room - 1)}\n`;

    appendOutput(output, kept);
    appendOutput(output, 'y'.repeat(MAX_OUTPUT_BYTES));

    expect(output.text).toBe(`${kept}${CUT_MARKER}`);
    expect(output.full).toBe(true);
  });

  it('adds nothing once it is full', () => {
    const output = emptyStreamOutput();
    appendOutput(output, 'x'.repeat(MAX_OUTPUT_BYTES + 1));
    const cut = { ...output };

    appendOutput(output, 'after the cut\n');

    expect(output).toEqual(cut);
  });
});
