/** Case ids in test names (`PRB-12`) and in `probara_case` properties. */

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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenPattern(projectCode: string): RegExp {
  const token = `${escapeRegExp(projectCode)}[-_](\\d+)`;
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

/**
 * Finds the `<CODE>-<n>` and `<CODE>_<n>` tokens of `projectCode` in `text` (case-sensitive, not
 * next to another letter or digit, optionally in `[]` or `()` or after `@`) and removes them, so
 * adding or removing an id never changes the text a key is built from. Without a project code,
 * nothing is parsed.
 */
export function extractCaseIds(text: string, projectCode: string | undefined): CaseIdExtraction {
  if (projectCode === undefined || projectCode === '') return { text, ids: [] };
  const pattern = tokenPattern(projectCode);
  const ids: string[] = [];
  let rest = text;
  for (let match = pattern.exec(rest); match !== null; match = pattern.exec(rest)) {
    // Only the group of the form that matched is set.
    const digits = match.slice(1).find(Boolean) ?? '';
    const id = `${projectCode}-${digits}`;
    if (!ids.includes(id)) ids.push(id);

    const before = rest.slice(0, match.index);
    const after = rest.slice(match.index + match[0].length);
    const separatorBefore = SEPARATORS_AT_END.exec(before)?.[0] ?? '';
    const separatorAfter = SEPARATORS_AT_START.exec(after)?.[0] ?? '';
    const head = before.slice(0, before.length - separatorBefore.length);
    const tail = after.slice(separatorAfter.length);
    // Keep one separator between two words; none at an edge or next to a bracket.
    const joiner =
      head === '' || tail === '' || OPENING_BRACKET.test(head) || CLOSING_BRACKET.test(tail)
        ? ''
        : separatorBefore || separatorAfter;
    rest = head + joiner + tail;
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
