/**
 * Debug IDs for built JavaScript files and their source maps: a snippet that registers the file's
 * debug ID at runtime, a `//# debugId=` comment, and `debug_id` in the map. The snippet goes on an
 * existing line, after a hashbang and the directive prologue (`"use strict"` stays in force), so
 * only the generated columns of that one line shift in the map.
 */
import { createHash } from 'node:crypto';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DEBUG_ID_COMMENT =
  /^\/\/# debugId=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})[ \t]*\r?$/m;
/** A trailing `//# sourceMappingURL=` comment on its own line. */
const TRAILING_MAP_URL = /(?:^|\n)(\/\/[#@] sourceMappingURL=[^\n]*\s*)$/;
/** What may follow a directive that ends at a line break: a token that starts a new statement. */
const STATEMENT_START = /^[A-Za-z_$'"{!;@#\\]/;

/** A source map: only what this changes is typed. */
export interface SourceMapJson {
  mappings?: unknown;
  debug_id?: unknown;
  [key: string]: unknown;
}

/** The debug ID of a built file and its map: a UUID derived from their contents, so stable. */
export function debugIdOf(code: string, map: string): string {
  const hex = createHash('sha256').update(code).update('\0').update(map).digest('hex');
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/** The debug ID a `//# debugId=` comment of `code` holds, once injected. */
export function injectedDebugIdOf(code: string): string | undefined {
  return DEBUG_ID_COMMENT.exec(code)?.[1]?.toLowerCase();
}

/** The snippet: records the stack of an error made in this file with its debug ID, never throws. */
export function snippetOf(debugId: string): string {
  return (
    ';!function(){try{var g="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:' +
    '"undefined"!=typeof window?window:"undefined"!=typeof global?global:{},s=(new g.Error).stack;' +
    `s&&((g._probaraDebugIds=g._probaraDebugIds||{})[s]="${debugId}")}catch(e){}}();`
  );
}

/** The end of the string literal that starts at `start`, or -1 when it does not end on its line. */
function stringEnd(code: string, start: number): number {
  const quote = code.charAt(start);
  for (let index = start + 1; index < code.length; index += 1) {
    const char = code.charAt(index);
    if (char === '\\') index += 1;
    else if (char === quote) return index + 1;
    else if (char === '\n') return -1;
  }
  return -1;
}

/** The end of the directive (a string literal statement) at `start`, or -1 when there is none. */
function directiveEnd(code: string, start: number): number {
  const end = stringEnd(code, start);
  if (end === -1) return -1;
  const rest = /^[ \t]*(;|\r?\n\s*|$)/.exec(code.slice(end));
  if (rest === null) return -1;
  if (rest[1] === ';') return end + rest[0].length;
  const next = code.slice(end + rest[0].length);
  return next === '' || STATEMENT_START.test(next) ? end : -1;
}

/**
 * Where the snippet goes: after a hashbang, the comments and the directives at the top of `code`,
 * so a `"use strict"` prologue stays one. Never inside a line comment.
 */
export function insertionPointOf(code: string): number {
  let at = code.startsWith('#!') ? code.indexOf('\n') + 1 || code.length : 0;
  let position = at;
  for (;;) {
    const space = /^\s*/.exec(code.slice(position))?.[0].length ?? 0;
    const start = position + space;
    let end = -1;
    if (code.startsWith('//', start)) {
      const newline = code.indexOf('\n', start);
      end = newline === -1 ? code.length : newline + 1;
    } else if (code.startsWith('/*', start)) {
      const close = code.indexOf('*/', start + 2);
      end = close === -1 ? -1 : close + 2;
    } else if (code.charAt(start) === '"' || code.charAt(start) === "'") {
      end = directiveEnd(code, start);
    }
    if (end === -1) return at;
    at = end;
    position = end;
  }
}

function decodeFirst(segment: string): { value: number; length: number } {
  let result = 0;
  let shift = 0;
  for (let index = 0; index < segment.length; index += 1) {
    const digit = BASE64.indexOf(segment.charAt(index));
    if (digit === -1) break;
    result += (digit & 31) * 2 ** shift;
    shift += 5;
    if ((digit & 32) === 0) {
      const value = result % 2 === 1 ? -Math.floor(result / 2) : result / 2;
      return { value, length: index + 1 };
    }
  }
  throw new Error('the mappings are not valid Base64 VLQ');
}

function encode(value: number): string {
  let rest = value < 0 ? -value * 2 + 1 : value * 2;
  let out = '';
  do {
    let digit = rest % 32;
    rest = Math.floor(rest / 32);
    if (rest > 0) digit += 32;
    out += BASE64.charAt(digit);
  } while (rest > 0);
  return out;
}

/**
 * `mappings` with the generated columns at or after `column` of `line` moved right by `by`.
 * Columns are relative within a line, so only the first segment at or past `column` changes.
 */
export function shiftColumns(mappings: string, line: number, column: number, by: number): string {
  const lines = mappings.split(';');
  const segments = lines[line]?.split(',');
  if (segments === undefined) return mappings;
  let generated = 0;
  for (const [index, segment] of segments.entries()) {
    if (segment === '') continue;
    const { value, length } = decodeFirst(segment);
    generated += value;
    if (generated >= column) {
      segments[index] = `${encode(value + by)}${segment.slice(length)}`;
      lines[line] = segments.join(',');
      return lines.join(';');
    }
  }
  return mappings;
}

/** `code` with the `//# debugId=` comment, before a trailing sourceMappingURL comment. */
function withDebugIdComment(code: string, debugId: string): string {
  const comment = `//# debugId=${debugId}`;
  const trailing = TRAILING_MAP_URL.exec(code);
  if (trailing?.[1] !== undefined) {
    const start = code.length - trailing[1].length;
    return `${code.slice(0, start)}${comment}\n${code.slice(start)}`;
  }
  return `${code}${code.endsWith('\n') || code === '' ? '' : '\n'}${comment}\n`;
}

/**
 * The injected `code` and `map` for `debugId`.
 *
 * @throws Error when `map` has no `mappings` string (an index map with sections, say).
 */
export function inject(
  code: string,
  map: SourceMapJson,
  debugId: string,
): { code: string; map: SourceMapJson } {
  if (typeof map.mappings !== 'string') {
    throw new Error('it has no mappings (index maps with sections are not supported)');
  }
  const at = insertionPointOf(code);
  const before = code.slice(0, at);
  const line = before.split('\n').length - 1;
  const column = at - (before.lastIndexOf('\n') + 1);
  const snippet = snippetOf(debugId);
  return {
    code: withDebugIdComment(`${before}${snippet}${code.slice(at)}`, debugId),
    map: {
      ...map,
      mappings: shiftColumns(map.mappings, line, column, snippet.length),
      debug_id: debugId,
    },
  };
}
