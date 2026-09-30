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
 * `<!-- output: <project> -->` blocks hold `$ <command>` lines, each followed by the `[probara]`
 * lines it logs (or its stdout with `stream: stdout`); `<!-- sent: <project> -->` blocks hold the
 * JSON entries Probara receives, as a subset of each. Both take a `scenario` (`scenarios.ts`).
 * `<!-- not-run: <reason> -->` exempts a block that is not an example of this reporter (Qase code).
 */
import { fencedBlocks, type FencedBlock } from '@probara/test-support/docs/markdown';
import { parseLine, probaraArgs, splitAssignments } from '@probara/test-support/docs/shell';

export interface Marker {
  name: string;
  value: string;
  settings: Record<string, string>;
}

/** `name: value, key: value...` of an HTML comment before a block. */
export function parseMarker(text: string | undefined): Marker | undefined {
  if (text === undefined) return undefined;
  const [first = '', ...rest] = text.split(',').map((part) => part.trim());
  const split = (part: string): [string, string] => {
    const index = part.indexOf(':');
    return index === -1 ? [part, ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  };
  const [name, value] = split(first);
  return { name, value, settings: Object.fromEntries(rest.map(split)) };
}

/** A Playwright project a page's code blocks make. */
export interface DocProject {
  id: string;
  where: string;
  /** Path in the project → content; the default files are laid out first. */
  files: Map<string, string>;
  /** Whether the blocks hold test files: the default tests are then left out. */
  ownTests: boolean;
  /** The exit code of `playwright test` (`exit:`), 0 by default. */
  exit: number;
  /** `reports: none`: the run is expected to send nothing. */
  reports: boolean;
}

export interface OutputCommand {
  command: string;
  expected: string[];
}

export interface OutputExample {
  where: string;
  project: string;
  scenario: string;
  stream: 'stderr' | 'stdout';
  commands: OutputCommand[];
}

export interface SentExample {
  where: string;
  project: string;
  scenario: string;
  entries: unknown[];
}

export interface Page {
  projects: DocProject[];
  outputs: OutputExample[];
  sent: SentExample[];
  notRun: { where: string; reason: string }[];
  problems: string[];
}

/** The project every example without its own files falls back to. */
export const DEFAULT_PROJECT = 'default';

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
function placeOf(block: FencedBlock): { path: string; content: string } | { error: string } {
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

/** The `$ ` commands of an output block, each with the lines after it. */
function commandsOf(content: string): OutputCommand[] | undefined {
  const commands: OutputCommand[] = [];
  for (const line of content.split('\n')) {
    if (line.startsWith('$ ')) commands.push({ command: line.slice(2), expected: [] });
    else if (commands.length === 0) return undefined;
    else commands[commands.length - 1]?.expected.push(line);
  }
  return commands.length === 0 ? undefined : commands;
}

/** Every example of a page: `file` names it in messages (`docs/steps.md`). */
export function pageOf(file: string, text: string): Page {
  const page: Page = { projects: [], outputs: [], sent: [], notRun: [], problems: [] };
  const byId = new Map<string, DocProject>();
  const references: { where: string; project: string; what: string }[] = [];

  for (const block of fencedBlocks(text)) {
    const where = `${file}:${block.line}`;
    const marker = parseMarker(block.marker);
    if (marker?.name === 'not-run') {
      page.notRun.push({ where, reason: marker.value });
      continue;
    }
    if (marker?.name === 'output') {
      const commands = commandsOf(block.content);
      if (commands === undefined)
        page.problems.push(`${where}: an output block starts with its "$ " command`);
      page.outputs.push({
        where,
        project: marker.value,
        scenario: marker.settings.scenario ?? '',
        stream: marker.settings.stream === 'stdout' ? 'stdout' : 'stderr',
        commands: commands ?? [],
      });
      references.push({ where, project: marker.value, what: 'output' });
      continue;
    }
    if (marker?.name === 'sent') {
      let entries: unknown[] = [];
      try {
        const parsed: unknown = JSON.parse(block.content);
        if (Array.isArray(parsed)) entries = parsed;
        else page.problems.push(`${where}: a sent block holds a JSON array of entries`);
      } catch (error) {
        page.problems.push(`${where}: a sent block is not JSON: ${String(error)}`);
      }
      page.sent.push({
        where,
        project: marker.value,
        scenario: marker.settings.scenario ?? '',
        entries,
      });
      references.push({ where, project: marker.value, what: 'sent' });
      continue;
    }
    if (!CODE_LANGUAGES.has(block.lang)) continue;

    const place = placeOf(block);
    if ('error' in place) {
      page.problems.push(`${where}: ${place.error}`);
      continue;
    }
    const id = marker?.name === 'project' ? marker.value : where;
    let project = byId.get(id);
    if (project === undefined) {
      project = { id, where, files: new Map(), ownTests: false, exit: 0, reports: true };
      byId.set(id, project);
      page.projects.push(project);
    }
    project.files.set(place.path, place.content);
    if (isTestFile(place.path)) project.ownTests = true;
    const settings = marker?.name === 'project' ? marker.settings : {};
    if (settings.exit !== undefined) project.exit = Number(settings.exit);
    if (settings.reports === 'none') project.reports = false;
  }

  for (const { where, project, what } of references) {
    if (project !== DEFAULT_PROJECT && !byId.has(project)) {
      page.problems.push(`${where}: ${what} of the unknown project "${project}"`);
    }
  }
  return page;
}

export type CommandKind = 'playwright' | 'probara' | 'install' | 'other';

export interface Command {
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
  const [first, second] = words;
  if (first === 'npm') return ['i', 'install', 'ci', 'add'].includes(second ?? '');
  if (first === 'pnpm' || first === 'yarn') return ['i', 'install', 'add'].includes(second ?? '');
  return playwrightArgs(words)?.[0] === 'install';
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

/** The values a CI matrix gives the first shard of a sharded job. */
const MATRIX: Readonly<Record<string, string>> = {
  'matrix.shard': '1',
  'matrix.shardIndex': '1',
  'matrix.shardTotal': '2',
};

/**
 * A command line with the GitHub Actions expressions of a shard matrix replaced by the first
 * shard's values; any other expression cannot run, so it throws.
 */
export function expandCiExpressions(line: string): string {
  return line.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (expression, name: string) => {
    const value = MATRIX[name];
    if (value === undefined) {
      throw new Error(`the docs tests cannot run ${expression} in a command line`);
    }
    return value;
  });
}

/**
 * `$((NAME + 1))` and `$((${NAME}+1))`, the shard number CircleCI and Buildkite scripts compute
 * from a 0-based index: sums and differences of integers and variables of `env`.
 */
export function expandArithmetic(
  line: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  return line.replace(/\$\(\(([^()]*)\)\)/g, (_match, expression: string) => {
    const terms = expression.replace(/\s+/g, '').split(/(?=[+-])/);
    let total = 0;
    for (const term of terms) {
      const sign = term.startsWith('-') ? -1 : 1;
      const operand = term.replace(/^[+-]/, '').replace(/^\$\{?|\}$/g, '');
      const value = /^\d+$/.test(operand) ? operand : env[operand];
      if (value === undefined) throw new Error(`${operand} is not set`);
      total += sign * Number(value);
    }
    return String(total);
  });
}

/** Whether a line runs `playwright` or the `probara` CLI, even inside `$(...)`. */
export function mentionsTool(line: string): boolean {
  return /(?:^|[\s"'(=])(?:playwright|probara|@probara\/cli(?:@\S+)?)(?=\s|$|\))/.test(line);
}

/** The lines the reporter and the CLI log: those of stderr that start with `[probara]`. */
export function probaraLines(stderr: string): string[] {
  return stderr.split('\n').filter((line) => line.startsWith('[probara]'));
}

/** Where the docs say the examples run. */
export const DOCS_DIR = '/work/shop';

/**
 * What varies from run to run: the fake's URL, the workspace, ULIDs, UUIDs, dates and delays.
 */
export function normalize(text: string, context: { baseUrl?: string; dir?: string } = {}): string {
  let result = text;
  if (context.baseUrl !== undefined) {
    result = result.replaceAll(context.baseUrl, 'https://app.probara.net');
  }
  if (context.dir !== undefined) result = result.replaceAll(context.dir, DOCS_DIR);
  return result
    .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, '<ULID>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<UUID>')
    .replace(
      /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?/g,
      '<DATE>',
    )
    .replace(/\b\d+ ms\b/g, '<N> ms');
}
