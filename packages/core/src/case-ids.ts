/**
 * Case ids in test names (`PRB-12`) and in explicit lists (a `probara_case` property or
 * annotation). Adapters remove the ids from the title before building the automation key, so
 * adding or removing an id never changes the key.
 */

export interface CaseIdExtraction {
  /** The text without its ids and the separators they leave behind. */
  text: string;
  /** Display ids (`PRB-12`), in order of appearance, once each. */
  ids: string[];
}

const SEPARATORS_AT_END = /[\s,;:|_\-–—]*$/u;
const SEPARATORS_AT_START = /^[\s,;:|_\-–—]*/u;
const OPENING_BRACKET = /[[(]$/;
const CLOSING_BRACKET = /^[\])]/;
/** A bracket that holds nothing but separators (or `@`) up to the end or from the start. */
const EMPTY_OPENING = /[[(][\s,;:|_\-–—@]*$/u;
const EMPTY_CLOSING = /^[\s,;:|_\-–—@]*[\])]/u;
const CLOSING_OF: Record<string, string> = { '[': ']', '(': ')' };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The id tokens of `projectCodes`: each alternative captures the code, then the number. */
function tokenPattern(projectCodes: readonly string[]): RegExp {
  // Longer codes first, so `WEBX-2` is never read as a code `WEB` followed by `X`.
  const codes = [...projectCodes]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  const token = `(${codes})[-_](\\d+)`;
  const notAlphanumeric = '(?![\\p{L}\\p{N}])';
  return new RegExp(
    [
      // Brackets bound the id on their own.
      `\\[${token}\\]`,
      `\\(${token}\\)`,
      `(?<![\\p{L}\\p{N}])@${token}${notAlphanumeric}`,
      `(?<![\\p{L}\\p{N}@])${token}${notAlphanumeric}`,
    ].join('|'),
    'u',
  );
}

/** The non-blank project codes of `projectCodes`, once each. */
function codesOf(projectCodes: string | readonly string[] | undefined): string[] {
  const list = typeof projectCodes === 'string' ? [projectCodes] : (projectCodes ?? []);
  return [...new Set(list.filter((code) => code !== ''))];
}

/**
 * Joins the text around a removed id. A bracket the id leaves empty (or holding only separators)
 * goes too, so `applies a coupon (@PRB-8)` keeps the title of `applies a coupon`. Brackets that
 * were empty before are kept: they are part of the name with or without the id.
 */
function joinAround(before: string, after: string): string {
  const opening = EMPTY_OPENING.exec(before);
  const closing = EMPTY_CLOSING.exec(after);
  if (opening !== null && closing !== null) {
    const [open] = opening[0];
    if (open !== undefined && CLOSING_OF[open] === closing[0].at(-1)) {
      return joinAround(before.slice(0, opening.index), after.slice(closing[0].length));
    }
  }
  const separatorBefore = SEPARATORS_AT_END.exec(before)?.[0] ?? '';
  const separatorAfter = SEPARATORS_AT_START.exec(after)?.[0] ?? '';
  const head = before.slice(0, before.length - separatorBefore.length);
  const tail = after.slice(separatorAfter.length);
  // Keep one separator between two words; none at an edge or next to a bracket.
  const joiner =
    head === '' || tail === '' || OPENING_BRACKET.test(head) || CLOSING_BRACKET.test(tail)
      ? ''
      : separatorBefore || separatorAfter;
  return head + joiner + tail;
}

/**
 * Finds the `<CODE>-<n>` and `<CODE>_<n>` tokens of `projectCodes` (one code or a list) in `text`
 * (case-sensitive, not next to another letter or digit, optionally in `[]` or `()` or after `@`)
 * and removes them, so adding or removing an id never changes the text a key is built from.
 * Without a project code, nothing is parsed.
 */
export function extractCaseIds(
  text: string,
  projectCodes: string | readonly string[] | undefined,
): CaseIdExtraction {
  const codes = codesOf(projectCodes);
  if (codes.length === 0) return { text, ids: [] };
  const pattern = tokenPattern(codes);
  const ids: string[] = [];
  let rest = text;
  for (let match = pattern.exec(rest); match !== null; match = pattern.exec(rest)) {
    // Only the groups of the form that matched are set: its code, then its number.
    const groups = match.slice(1);
    const start = groups.findIndex(Boolean);
    const id = `${groups[start] ?? ''}-${groups[start + 1] ?? ''}`;
    if (!ids.includes(id)) ids.push(id);

    rest = joinAround(rest.slice(0, match.index), rest.slice(match.index + match[0].length));
  }
  return { text: ids.length === 0 ? text : rest.trim(), ids };
}

/** The ids of a `probara_case` property: a comma-separated list, trimmed, once each. */
export function parseCaseIdList(value: string): string[] {
  const ids: string[] = [];
  for (const part of value.split(',')) {
    const id = part.trim();
    if (id !== '' && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export interface TitlePathCaseIdExtraction {
  /** The segments without their ids; segments left blank are dropped. */
  titlePath: string[];
  /** Display ids (`PRB-12`), in order of appearance, once each. */
  ids: string[];
}

/**
 * {@link extractCaseIds} on every segment of a title path. A segment left blank is dropped; when
 * nothing but ids is left, the segments are kept as they were, so the test keeps a title.
 */
export function extractTitlePathCaseIds(
  titlePath: readonly string[],
  projectCodes: string | readonly string[] | undefined,
): TitlePathCaseIdExtraction {
  const ids: string[] = [];
  const cleaned = titlePath.map((segment) => {
    const extraction = extractCaseIds(segment, projectCodes);
    for (const id of extraction.ids) if (!ids.includes(id)) ids.push(id);
    return extraction.text;
  });
  const left = cleaned.filter((segment) => segment.trim() !== '');
  return { titlePath: left.length > 0 ? left : [...titlePath], ids };
}

/** A case display id: a project code (a capital letter, then capitals or digits), `-`, a number from 1. */
const CASE_DISPLAY_ID = /^([A-Z][A-Z0-9]*)-([1-9][0-9]*)$/;

/** The project code and number of a well-formed display id (`WEB-3`), else `undefined`. */
export function parseCaseDisplayId(
  id: string,
): { projectCode: string; number: number } | undefined {
  const match = CASE_DISPLAY_ID.exec(id);
  if (match === null) return undefined;
  const [, projectCode = '', digits = ''] = match;
  return { projectCode, number: Number(digits) };
}
