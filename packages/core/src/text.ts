/** Text helpers that keep adapter-provided strings within the report contract. */

// ANSI escape sequences: OSC (ESC ] ... ST) and CSI/related sequences. The pattern of `ansi-regex`
// 6.1 (MIT, Sindre Sorhus), which `strip-ansi` uses, inlined to keep core free of dependencies.
const ANSI_ST = '(?:\\u0007|\\u001B\\u005C|\\u009C)';
const ANSI_OSC = `(?:\\u001B\\][\\s\\S]*?${ANSI_ST})`;
const ANSI_CSI =
  '[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]';
const ANSI_PATTERN = new RegExp(`${ANSI_OSC}|${ANSI_CSI}`, 'g');

// C0 and C1 control characters and DEL.
// eslint-disable-next-line no-control-regex -- the class IS the control-character set to replace
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
// The same set without `\t` (U+0009) and `\n` (U+000A).
// eslint-disable-next-line no-control-regex -- the class IS the control-character set to replace
const CONTROL_CHARACTERS_BUT_TAB_AND_NEWLINE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/**
 * `text` with every lone (unpaired) surrogate replaced with U+FFFD, so it encodes as valid UTF-8 and
 * a JSON body never carries ill-formed UTF-16. Every normalizing helper below applies it.
 */
export function toWellFormed(text: string): string {
  return text.toWellFormed();
}

/** Removes ANSI escape sequences (colours, cursor moves, OSC hyperlinks). */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/**
 * NFC-normalizes `text`, turns every control character and whitespace run into one space, and
 * trims it: the form of a title, a suite name or an automation key segment.
 */
export function toSingleLine(text: string): string {
  return toWellFormed(text)
    .normalize('NFC')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Removes C0 and C1 control characters and DEL, keeping everything else as is. */
export function removeControlCharacters(text: string): string {
  return toWellFormed(text).replace(CONTROL_CHARACTERS, '');
}

/**
 * Normalizes line breaks (`\r\n` and `\r` become `\n`) and replaces control characters other than
 * `\n` and `\t` with a space: the form of free text such as notes.
 */
export function toMultiline(text: string): string {
  return toWellFormed(text)
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARACTERS_BUT_TAB_AND_NEWLINE, ' ');
}

/** The first `length` UTF-16 code units of `text`, one fewer when the cut would split a pair. */
export function sliceCodeUnits(text: string, length: number): string {
  if (text.length <= length) return text;
  const code = text.charCodeAt(length - 1);
  const splitsPair = code >= 0xd800 && code <= 0xdbff;
  return text.slice(0, splitsPair ? length - 1 : length);
}

/**
 * `text` unchanged when it fits in `max` UTF-16 code units, otherwise cut (surrogate-safe, trailing
 * whitespace trimmed) and ended with `marker`, the whole within `max`.
 */
export function truncate(text: string, max: number, marker = '…'): string {
  if (text.length <= max) return text;
  return `${sliceCodeUnits(text, max - marker.length).trimEnd()}${marker}`;
}
