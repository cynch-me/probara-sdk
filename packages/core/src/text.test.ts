import { describe, expect, it } from 'vitest';
import { sliceCodeUnits, stripAnsi, toMultiline, toSingleLine, truncate } from './text.js';

describe('stripAnsi', () => {
  it('removes colour and cursor sequences', () => {
    expect(stripAnsi('\u001b[31mexpected\u001b[39m \u001b[1;32mreceived\u001b[0m')).toBe(
      'expected received',
    );
    expect(stripAnsi('\u001b[2K\u001b[1Gdone')).toBe('done');
  });

  it('removes OSC hyperlinks but keeps their text', () => {
    expect(stripAnsi('see \u001b]8;;https://example.test\u0007the docs\u001b]8;;\u0007')).toBe(
      'see the docs',
    );
  });
});

describe('toSingleLine', () => {
  it('turns control characters and whitespace runs into single spaces, trimmed', () => {
    expect(toSingleLine('  logs\tin \n\n with\u0000a\u007fbad\u009bpassword  ')).toBe(
      'logs in with a bad password',
    );
    expect(toSingleLine('   wide space ')).toBe('wide space');
  });

  it('composes decomposed unicode (NFC)', () => {
    expect(toSingleLine('Café')).toBe('Café');
  });
});

describe('toMultiline', () => {
  it('keeps newlines and tabs, normalizes CRLF and replaces other control characters', () => {
    expect(toMultiline('line 1\r\nline\t2\rline 3\u0000!')).toBe('line 1\nline\t2\nline 3 !');
  });
});

describe('sliceCodeUnits', () => {
  it('never splits a surrogate pair', () => {
    expect(sliceCodeUnits('ab\u{1f600}cd', 3)).toBe('ab');
    expect(sliceCodeUnits('ab\u{1f600}cd', 4)).toBe('ab\u{1f600}');
    expect(sliceCodeUnits('abc', 10)).toBe('abc');
  });
});

describe('truncate', () => {
  it('leaves text within the limit unchanged', () => {
    expect(truncate('exactly ten', 11)).toBe('exactly ten');
  });

  it('ends truncated text with an ellipsis within the limit', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(truncate('abc defghij', 5)).toBe('abc…');
  });

  it('does not split a surrogate pair at the cut', () => {
    const cut = truncate('abc\u{1f600}def', 5);
    expect(cut).toBe('abc…');
    expect(cut.length).toBeLessThanOrEqual(5);
  });

  it('uses a custom marker and keeps the result within the limit', () => {
    const cut = truncate('x'.repeat(50), 20, '\n…[truncated]');
    expect(cut).toBe(`${'x'.repeat(7)}\n…[truncated]`);
    expect(cut).toHaveLength(20);
  });
});
