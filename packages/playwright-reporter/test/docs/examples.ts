/**
 * How the docs tests read the examples of a page. Code blocks (`ts`, `js`) become files of a
 * Playwright project that runs with the real reporter:
 *
 * - A block that starts with a path comment (`// tests/checkout.spec.ts`, `// playwright.config.ts`)
 *   is that file. Without one, a whole config (`defineConfig(`) is `playwright.config.ts`, a test
 *   file (`from '@playwright/test'`) is `tests/example.spec.ts`, and properties (`reporter: [...]`)
 *   are a config fragment, wrapped into the default config after its keys, so they win.
 * - `<!-- project: <id> -->` before blocks puts them in one project; settings after the id apply to
 *   it (`exit: 1`, `reports: none`). A block without a marker is a project of its own.
 * - A project without test files of its own runs the default tests of `project/`.
 *
 * `<!-- output: <project> -->` blocks hold `$ <command>` lines, run in one copy of the project, each
 * followed by the `[probara]` lines it logs (the stdout of a `probara` command with `stream:
 * stdout`); `<!-- sent: <project> -->` blocks hold the JSON entries Probara receives, as a subset of
 * each; `<!-- files: <project> -->` blocks list the files uploaded (`<name> <content type>`, any
 * order). They take a `scenario` (`scenarios.ts`). A project with a `merge.config.ts` is merged from
 * the blob reports of its tests (`playwright merge-reports --config merge.config.ts`) instead of
 * run.
 * `<!-- not-run: <reason> -->` exempts a block that is not an example of this reporter (Qase code).
 * Any other block fails its page, unless it is a command block (`bash`, `yaml`...) without a marker,
 * which the command-line tests run.
 */
import type { FencedBlock } from '@probara/test-support/docs/markdown';
import {
  isPackageInstall,
  mentionsToolOf,
  readPage,
  unusedProblems,
  type Command as DocsCommand,
  type Page,
  type PageRules,
  type Placement,
} from '@probara/test-support/docs/examples';
import { parseLine, probaraArgs, splitAssignments } from '@probara/test-support/docs/shell';

export {
  DEFAULT_PROJECT,
  DOCS_DIR,
  expandArithmetic,
  expandCiExpressions,
  normalize,
  parseMarker,
  probaraLines,
  type DocProject,
  type FilesExample,
  type Marker,
  type OutputCommand,
  type OutputExample,
  type Page,
  type SentExample,
} from '@probara/test-support/docs/examples';

const CODE_LANGUAGES = new Set(['ts', 'typescript', 'js', 'javascript', 'mjs']);
const PATH_COMMENT = /^\/\/\s*(\S+\.(?:[cm]?[jt]s))\s*$/;
const CONFIG_FILE = 'playwright.config.ts';
const DEFAULT_TEST = 'tests/example.spec.ts';

/** The default config a fragment goes into, after its keys. */
function wrapFragment(fragment: string): string {
  const body = fragment.trimEnd();
  const lines = body.split('\n').map((line) => `  ${line}`);
  const last = lines.length - 1;
  if (!(lines[last] ?? '').trimEnd().endsWith(',')) lines[last] = `${lines[last] ?? ''},`;
  return [
    "import { defineConfig } from '@playwright/test';",
    '',
    'export default defineConfig({',
    "  testDir: './tests',",
    '  workers: 1,',
    "  reporter: [['@probara/playwright-reporter']],",
    ...lines,
    '});',
    '',
  ].join('\n');
}

function isTestFile(path: string): boolean {
  return /\.(?:spec|test)\.[cm]?[jt]s$/.test(path);
}

/** Where a code block goes in its project, or why it cannot go anywhere. */
function placeOf(block: FencedBlock): Placement {
  const [first = '', ...rest] = block.content.split('\n');
  const named = PATH_COMMENT.exec(first.trim());
  if (named !== null) return { path: named[1] ?? '', content: `${rest.join('\n')}\n` };
  const content = `${block.content}\n`;
  if (block.content.includes('defineConfig(')) return { path: CONFIG_FILE, content };
  if (/from ['"]@playwright\/test['"]/.test(block.content)) return { path: DEFAULT_TEST, content };
  if (/^[A-Za-z_$][\w$]*\s*:/.test(block.content.trim())) {
    return { path: CONFIG_FILE, content: wrapFragment(block.content) };
  }
  return {
    error: `a ${block.lang} block the harness cannot place: start it with a path comment (// tests/<name>.spec.ts), or make it a whole config or test file`,
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

export type CommandKind = 'playwright' | 'probara' | 'install' | 'other';

export interface Command extends DocsCommand {
  kind: CommandKind;
  args: string[];
  assignments: [string, string][];
}

/** `playwright` as the docs run it: through npx, pnpm exec, yarn or the bin itself. */
function playwrightArgs(words: readonly string[]): string[] | undefined {
  const [first, second, third] = words;
  if (first === 'npx' && second === 'playwright') return words.slice(2);
  if ((first === 'pnpm' || first === 'yarn') && second === 'exec' && third === 'playwright') {
    return words.slice(3);
  }
  if (first === 'playwright') return words.slice(1);
  return undefined;
}

function isInstall(words: readonly string[]): boolean {
  return isPackageInstall(words) || playwrightArgs(words)?.[0] === 'install';
}

/** What one command line of the docs runs, with its variables expanded from `env`. */
export async function commandOf(
  line: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<Command> {
  const { words } = await parseLine(line, env, () => Promise.resolve(''));
  const { assignments, command } = splitAssignments(words);
  if (isInstall(command)) return { kind: 'install', args: command, assignments };
  const playwright = playwrightArgs(command);
  if (playwright !== undefined) return { kind: 'playwright', args: playwright, assignments };
  const probara = probaraArgs(command);
  if (probara !== undefined) return { kind: 'probara', args: probara, assignments };
  return { kind: 'other', args: command, assignments };
}

/** Whether a line runs `playwright` or the `probara` CLI, even inside `$(...)`. */
export const mentionsTool: (line: string) => boolean = mentionsToolOf('playwright');
