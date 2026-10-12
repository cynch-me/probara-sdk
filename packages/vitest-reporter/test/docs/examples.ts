/**
 * How the docs harness reads the examples of a Vitest page (`@probara/test-support/docs/examples` holds the markers).
 * Code blocks (`js`, `ts`, `json`...) become files of a Vitest project that runs with the real reporter:
 *
 * - A block that starts with a path comment (`// tests/cart.test.ts`, `// vitest.config.mts`, `// package.json`) is that
 *   file. Without one, a whole config (`export default`) is `vitest.config.mts`, a test file (`test(`, `it(`,
 *   `describe(`) is `tests/example.test.ts`, and a fragment (`reporters: [...]`) is wrapped into the default config's
 *   `test` section, after its keys, so the fragment's keys win. A fragment that is a `test` section of its own
 *   (`test: { ... }`) is wrapped at the top level.
 * - Vitest reads TypeScript as it is, so `ts` examples run without a transform.
 * - Any other block fails its page, unless it is a command block (`bash`, `yaml`...) without a marker, which the
 *   command-line tests run: a JSON block without a path, a misspelled or detached marker, a `jsx` or `tsx` block would
 *   otherwise go unchecked.
 * - A project without test files of its own runs the default tests of the docs project.
 *
 * Commands: `vitest` (through npx, `vitest@5` too, pnpm, yarn or the bin itself), and the `test` script of npm, pnpm and
 * yarn, which the docs project defines as `vitest run`; the `probara` CLI as `@probara/test-support` knows it.
 */
import {
  isPackageInstall,
  mentionsToolOf,
  normalize,
  probaraLines,
  readPage,
  unusedProblems,
  type Command as DocsCommand,
  type Page,
  type PageRules,
  type Placement,
} from '@probara/test-support/docs/examples';
import type { FencedBlock } from '@probara/test-support/docs/markdown';
import { parseLine, probaraArgs, splitAssignments } from '@probara/test-support/docs/shell';

export {
  DEFAULT_PROJECT,
  normalize,
  probaraLines,
  type DocProject,
  type OutputExample,
  type Page,
} from '@probara/test-support/docs/examples';

const CODE_LANGUAGES = new Set([
  'js',
  'javascript',
  'mjs',
  'cjs',
  'mts',
  'ts',
  'typescript',
  'json',
]);
const PATH_COMMENT = /^\/\/\s*(\S+\.(?:[cm]?[jt]sx?|json))\s*$/;
/** The file a whole config or a fragment goes into: Vitest's own configuration file. */
export const CONFIG_FILE = 'vitest.config.mts';
const DEFAULT_TEST = 'tests/example.test.ts';

/** The default config a fragment goes into: the docs project's `include` and reporter, then the fragment's keys. */
function wrapFragment(fragment: string): string {
  const lines = fragment
    .trimEnd()
    .split('\n')
    .map((line) => line.trimEnd());
  const last = lines.length - 1;
  if (!(lines[last] ?? '').endsWith(',')) lines[last] = `${lines[last] ?? ''},`;
  if (/^\s*test\s*:/m.test(fragment)) {
    return [
      "import { defineConfig } from 'vitest/config';",
      '',
      'export default defineConfig({',
      ...lines.map((line) => `  ${line}`),
      '});',
      '',
    ].join('\n');
  }
  return [
    "import { defineConfig } from 'vitest/config';",
    '',
    'export default defineConfig({',
    '  test: {',
    "    include: ['tests/**/*.test.ts'],",
    "    reporters: ['default', '@probara/vitest-reporter'],",
    ...lines.map((line) => `    ${line}`),
    '  },',
    '});',
    '',
  ].join('\n');
}

/** Whether a path of a project is a test file, as Vitest's default `include` finds them. */
export function isTestFile(path: string): boolean {
  return /(?:\.(?:spec|test)\.[cm]?[jt]sx?|(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?)$/.test(path);
}

/** Where a code block goes in its project, or why it cannot go anywhere. */
function placeOf(block: FencedBlock): Placement | undefined {
  const [first = '', ...rest] = block.content.split('\n');
  const named = PATH_COMMENT.exec(first.trim());
  if (named !== null) return { path: named[1] ?? '', content: `${rest.join('\n')}\n` };
  if (block.lang === 'json') return undefined;
  const content = `${block.content}\n`;
  if (/^\s*export\s+default\b/m.test(block.content)) return { path: CONFIG_FILE, content };
  if (/(?:^|[\s;(])(?:test|it|describe)(?:\.[\w]+)*\s*\(/.test(block.content)) {
    return { path: DEFAULT_TEST, content };
  }
  if (/^\s*[A-Za-z_$][\w$]*\s*:/.test(block.content)) {
    return { path: CONFIG_FILE, content: wrapFragment(block.content) };
  }
  return {
    error: `a ${block.lang} block the harness cannot place: start it with a path comment (// tests/<name>.test.ts), or make it a whole config or test file`,
  };
}

const RULES: PageRules = { languages: CODE_LANGUAGES, place: placeOf, isTestFile };

/**
 * Every example of a page: `file` names it in messages (`docs/steps.md`). A block the docs tests would not run is a
 * problem of the page (`unusedProblems`).
 */
export function pageOf(file: string, text: string): Page {
  const page = readPage(file, text, RULES);
  page.problems.push(...unusedProblems(page, RULES));
  return page;
}

export type CommandKind = 'vitest' | 'probara' | 'install' | 'other';

export interface Command extends DocsCommand {
  kind: CommandKind;
}

/** The arguments after `--` of a package script, with the script's own `run` first. */
function scriptArgs(words: readonly string[]): string[] {
  const index = words.indexOf('--');
  return ['run', ...(index === -1 ? [] : words.slice(index + 1))];
}

/** `vitest`, or `vitest@<version>` as npx takes it. */
const VITEST = /^vitest(?:@[\w.^~-]+)?$/;

/**
 * The arguments of a pnpm or yarn script after its name, which both pass on. Yarn 1 drops a leading `--`, as npm does;
 * pnpm passes it on too, so `pnpm test -- --reporter=dot` reaches the script as it does for a user.
 */
function passedArgs(words: readonly string[], from: number): string[] {
  const args = words.slice(from);
  return ['run', ...(words[0] === 'yarn' && args[0] === '--' ? args.slice(1) : args)];
}

/** `vitest` as the docs run it: through npx, pnpm or yarn, the `test` script of npm, pnpm or yarn, or the bin itself. */
function vitestArgs(words: readonly string[]): string[] | undefined {
  const [first, second, third] = words;
  if (first === 'npx' && VITEST.test(second ?? '')) return words.slice(2);
  if ((first === 'pnpm' || first === 'yarn') && second === 'exec' && third === 'vitest') {
    return words.slice(3);
  }
  if ((first === 'pnpm' || first === 'yarn') && second === 'vitest') return words.slice(2);
  if (first === 'npm' && second === 'test') return scriptArgs(words);
  if (first === 'npm' && second === 'run' && third === 'test') return scriptArgs(words);
  if ((first === 'pnpm' || first === 'yarn') && second === 'test') return passedArgs(words, 2);
  if ((first === 'pnpm' || first === 'yarn') && second === 'run' && third === 'test') {
    return passedArgs(words, 3);
  }
  if (first === 'vitest' || first === 'node_modules/.bin/vitest') return words.slice(1);
  return undefined;
}

/** What one command line of the docs runs, with its variables expanded from `env`. */
export async function commandOf(
  line: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<Command> {
  const { words } = await parseLine(line, env, () => Promise.resolve(''));
  const { assignments, command } = splitAssignments(words);
  if (isPackageInstall(command)) return { kind: 'install', args: command, assignments };
  const vitest = vitestArgs(command);
  if (vitest !== undefined) return { kind: 'vitest', args: vitest, assignments };
  const probara = probaraArgs(command);
  if (probara !== undefined) return { kind: 'probara', args: probara, assignments };
  return { kind: 'other', args: command, assignments };
}

/**
 * Whether a line runs `vitest` (`vitest@5`, and the `test` script of npm, pnpm and yarn included) or the `probara` CLI,
 * even inside `$(...)`.
 */
export const mentionsTool: (line: string) => boolean = mentionsToolOf(
  'vitest(?:@[\\w.^~-]+)?|(?:npm|pnpm|yarn) (?:run )?test',
);

/**
 * The lines of every run that reports, not compared outside output blocks: `Sending`, `Recorded`, and `Attached` when
 * no file was skipped and none failed.
 */
const REPORT_LINE =
  /^\[probara\] (?:Sending |Recorded |Attached \d+ files? to results \(0 skipped, 0 failed\)$)/;

/**
 * The `[probara]` lines of `stderr` other than the report's own ({@link REPORT_LINE}) that `shown`, the lines of the
 * output blocks of the example, does not list: a warning or an error the page never shows.
 */
export function unshownLines(
  stderr: string,
  shown: readonly string[],
  context: { baseUrl?: string; dir?: string },
): string[] {
  const listed = new Set(shown.map((line) => normalize(line, context)));
  return probaraLines(stderr).filter(
    (line) => !REPORT_LINE.test(line) && !listed.has(normalize(line, context)),
  );
}

/** A ULID, as {@link normalize} finds one. */
const ULID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;

/**
 * Numbers the distinct ULIDs of `text` in the order they first appear (`<ULID 1>`, `<ULID 2>`...), so that, once
 * {@link normalize} hides their values, an output block still shows a new run's ULID where the reporter logs another run,
 * and the same ULID where it logs the same run again (V-D146).
 */
export function numberUlids(text: string): string {
  const numbers = new Map<string, number>();
  return text.replace(ULID, (ulid) => {
    const number = numbers.get(ulid) ?? numbers.size + 1;
    numbers.set(ulid, number);
    return `<ULID ${String(number)}>`;
  });
}
