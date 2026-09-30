/**
 * How the docs tests read the examples of a page (`@probara/test-support/docs/examples` holds the
 * markers). Code blocks (`js`, `ts`, `json`) become files of a Jest project that runs with the real
 * reporter:
 *
 * - A block that starts with a path comment (`// tests/cart.test.js`, `// jest.config.mjs`,
 *   `// package.json`) is that file. Without one, a whole config (`module.exports =`) is
 *   `jest.config.js` (`export default` makes it `jest.config.mjs`), a test file (`test(`, `it(`,
 *   `describe(`) is `tests/example.test.js`, and properties (`reporters: [...]`) are a config
 *   fragment, wrapped into the default config after its keys, so they win.
 * - Any other block fails its page, unless it is a command block (`bash`, `yaml`...) without a
 *   marker, which the command-line tests run: a JSON block without a path, a block with a
 *   misspelled or detached marker, a `jsx` or `tsx` block would otherwise go unchecked
 *   (`@probara/test-support/docs/examples` says which a detached marker escapes).
 * - A project without test files of its own runs the default tests of `project/`.
 * - The docs project has a Babel config that compiles `import` to `require`, as a project whose
 *   tests use ES modules does; TypeScript does not run there, so examples are JavaScript.
 *
 * Commands: `jest` through npx (`jest@30` too), pnpm, yarn or the bin itself, and the `test` script
 * of npm, pnpm and yarn (the docs project's is `jest`); the `probara` CLI as `@probara/test-support`
 * knows it.
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

const CODE_LANGUAGES = new Set(['js', 'javascript', 'mjs', 'cjs', 'ts', 'typescript', 'json']);
const PATH_COMMENT = /^\/\/\s*(\S+\.(?:[cm]?[jt]sx?|json))\s*$/;
export const CONFIG_FILE = 'jest.config.js';
const ESM_CONFIG_FILE = 'jest.config.mjs';
const DEFAULT_TEST = 'tests/example.test.js';

/** The default config a fragment goes into, after its keys. */
function wrapFragment(fragment: string): string {
  const lines = fragment
    .trimEnd()
    .split('\n')
    .map((line) => `  ${line}`);
  const last = lines.length - 1;
  if (!(lines[last] ?? '').trimEnd().endsWith(',')) lines[last] = `${lines[last] ?? ''},`;
  return [
    'module.exports = {',
    "  testEnvironment: 'node',",
    "  reporters: ['default', '@probara/jest-reporter'],",
    ...lines,
    '};',
    '',
  ].join('\n');
}

/** Whether a path of a project is a test file, as Jest's default `testMatch` finds them. */
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
  if (/^\s*module\.exports\s*=/m.test(block.content)) return { path: CONFIG_FILE, content };
  if (/^\s*export\s+default\b/m.test(block.content)) return { path: ESM_CONFIG_FILE, content };
  if (/(?:^|[\s;(])(?:test|it|describe)(?:\.[\w]+)*\s*\(/.test(block.content)) {
    return { path: DEFAULT_TEST, content };
  }
  if (/^[A-Za-z_$][\w$]*\s*:/.test(block.content.trim())) {
    return { path: CONFIG_FILE, content: wrapFragment(block.content) };
  }
  return {
    error: `a ${block.lang} block the harness cannot place: start it with a path comment (// tests/<name>.test.js), or make it a whole config or test file`,
  };
}

const RULES: PageRules = { languages: CODE_LANGUAGES, place: placeOf, isTestFile };

/**
 * Every example of a page: `file` names it in messages (`docs/steps.md`). A block the docs tests
 * would not run is a problem of the page (`unusedProblems`).
 */
export function pageOf(file: string, text: string): Page {
  const page = readPage(file, text, RULES);
  page.problems.push(...unusedProblems(page, RULES));
  return page;
}

export type CommandKind = 'jest' | 'probara' | 'install' | 'other';

export interface Command extends DocsCommand {
  kind: CommandKind;
}

/** The arguments after `--` of a package script, or none. */
function scriptArgs(words: readonly string[]): string[] {
  const index = words.indexOf('--');
  return index === -1 ? [] : words.slice(index + 1);
}

/** `jest`, or `jest@<version>` as npx takes it. */
const JEST = /^jest(?:@[\w.^~-]+)?$/;

/** The arguments of a pnpm or yarn script after its name: both pass them on, `--` or not. */
function passedArgs(words: readonly string[], from: number): string[] {
  const args = words.slice(from);
  return args[0] === '--' ? args.slice(1) : args;
}

/**
 * `jest` as the docs run it: through npx (`jest@30` too), pnpm, yarn, the `test` script of npm,
 * pnpm or yarn (the docs project's is `jest`), or the bin itself.
 */
function jestArgs(words: readonly string[]): string[] | undefined {
  const [first, second, third] = words;
  if (first === 'npx' && JEST.test(second ?? '')) return words.slice(2);
  if ((first === 'pnpm' || first === 'yarn') && second === 'exec' && third === 'jest') {
    return words.slice(3);
  }
  if ((first === 'pnpm' || first === 'yarn') && second === 'jest') return words.slice(2);
  if (first === 'npm' && second === 'test') return scriptArgs(words);
  if (first === 'npm' && second === 'run' && third === 'test') return scriptArgs(words);
  if ((first === 'pnpm' || first === 'yarn') && second === 'test') return passedArgs(words, 2);
  if ((first === 'pnpm' || first === 'yarn') && second === 'run' && third === 'test') {
    return passedArgs(words, 3);
  }
  if (first === 'jest' || first === 'node_modules/.bin/jest') return words.slice(1);
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
  const jest = jestArgs(command);
  if (jest !== undefined) return { kind: 'jest', args: jest, assignments };
  const probara = probaraArgs(command);
  if (probara !== undefined) return { kind: 'probara', args: probara, assignments };
  return { kind: 'other', args: command, assignments };
}

/**
 * Whether a line runs `jest` (`jest@30`, and the `test` script of npm, pnpm and yarn included) or
 * the `probara` CLI, even inside `$(...)`.
 */
export const mentionsTool: (line: string) => boolean = mentionsToolOf(
  'jest(?:@[\\w.^~-]+)?|(?:npm|pnpm|yarn) (?:run )?test',
);

/**
 * The lines of every run that reports, not compared outside output blocks: `Sending`, `Recorded`,
 * and `Attached` when no file was skipped and none failed.
 */
const REPORT_LINE =
  /^\[probara\] (?:Sending |Recorded |Attached \d+ files? to results \(0 skipped, 0 failed\)$)/;

/**
 * The `[probara]` lines of `stderr` other than the report's own ({@link REPORT_LINE}) that
 * `shown`, the lines of the output blocks of the example, does not list: a warning or an error the
 * page never shows, such as the one a misspelled option logs.
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
