import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { MAX_AUTOMATION_KEY_LENGTH } from './limits.js';
import { sliceCodeUnits, toSingleLine } from './text.js';

/** What identifies one test, as the framework reports it. */
export interface TestIdentity {
  /** The test file, absolute or relative to the root directory. */
  file?: string;
  /** Describe blocks, then the test title: `['Login', 'rejects a bad password']`. */
  titlePath: readonly string[];
  /** Parameters that tell apart runs of the same test, such as the browser or the locale. */
  parameters?: Readonly<Record<string, string | number | boolean>>;
}

export interface AutomationKeyOptions {
  /** Directory the key's file path is relative to. Defaults to `process.cwd()`. */
  rootDir?: string;
}

const SEPARATOR = ' > ';
const HASH_SUFFIX_LENGTH = 18; // ' #' + 16 hex characters

/** The file part of a key: POSIX separators, relative to `rootDir`, `''` when there is none. */
export function normalizeTestFile(file: string | undefined, rootDir: string): string {
  if (file === undefined) return '';
  let path = file.normalize('NFC').trim();
  if (win32.isAbsolute(path) && /^[a-zA-Z]:[\\/]/.test(path) && win32.isAbsolute(rootDir)) {
    path = win32.relative(rootDir, path);
  } else if (path.startsWith('/') && rootDir.startsWith('/')) {
    path = posix.relative(rootDir, path);
  }
  return toSingleLine(
    path
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/')
      .replace(/^(?:\.\/)+/, ''),
  );
}

/** The title segments, normalized, with the parameters suffix on the last one. */
export function normalizeTitlePath(identity: TestIdentity): string[] {
  const segments = identity.titlePath.map(toSingleLine).filter((segment) => segment !== '');
  const last = segments.pop();
  if (last === undefined) {
    throw new TypeError('A test identity needs at least one non-empty title segment');
  }
  const parameters = Object.entries(identity.parameters ?? {})
    .map(([name, value]) => [toSingleLine(name), toSingleLine(String(value))] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`);
  segments.push(parameters.length > 0 ? `${last} [${parameters.join(', ')}]` : last);
  return segments;
}

/**
 * Keeps a key within {@link MAX_AUTOMATION_KEY_LENGTH}: a longer key keeps its first
 * `1024 - 18` code units (surrogate-safe, trailing spaces trimmed) and gets ` #` plus the first 16
 * hex characters of the SHA-256 of the full key, so long keys stay distinct.
 */
export function fitAutomationKey(key: string): string {
  if (key.length <= MAX_AUTOMATION_KEY_LENGTH) return key;
  const hash = createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
  const head = sliceCodeUnits(key, MAX_AUTOMATION_KEY_LENGTH - HASH_SUFFIX_LENGTH).trimEnd();
  return `${head} #${hash}`;
}

/**
 * Builds the automation key that links a test to its Probara case.
 *
 * Key v1 is a public, frozen contract: every adapter must build the same key for the same test,
 * and changing the algorithm unlinks every case already reported. The steps:
 *
 * 1. `file`: an absolute path is made relative to `rootDir` (default `process.cwd()`); `\` becomes
 *    `/`, repeated `/` collapse, a leading `./` is removed, and it is normalized like a segment
 *    (step 2). An empty file is left out.
 * 2. Each `titlePath` segment is NFC-normalized, its control characters and whitespace runs become
 *    one space, and it is trimmed. Empty segments are dropped.
 * 3. Non-empty `parameters` are sorted by key (plain UTF-16 code-unit order), rendered as
 *    `key=value` (values through `String()`, both normalized like segments), joined with `, `
 *    inside `[...]` and appended to the last segment after a space:
 *    `logs in [browser=chromium, locale=es]`.
 * 4. The file and the segments are joined with ` > `. Case is preserved.
 * 5. A key over 1024 UTF-16 code units keeps its first 1006 (surrogate-safe, trailing spaces
 *    trimmed) followed by ` #` and the first 16 hex characters of the SHA-256 (UTF-8) of the full
 *    key.
 *
 * Example: `e2e/login.spec.ts > Login > logs in [browser=chromium]`.
 *
 * @throws TypeError when no title segment remains (an adapter bug).
 */
export function buildAutomationKey(
  identity: TestIdentity,
  options: AutomationKeyOptions = {},
): string {
  const segments = normalizeTitlePath(identity);
  const file = normalizeTestFile(identity.file, options.rootDir ?? process.cwd());
  return fitAutomationKey((file === '' ? segments : [file, ...segments]).join(SEPARATOR));
}
