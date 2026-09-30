/**
 * How the docs tests of a framework reporter read the examples of a page. The reporter's harness
 * says where a code block goes in its project ({@link PageRules}); the rest is the same for every
 * reporter:
 *
 * - `<!-- project: <id> -->` before blocks puts them in one project; settings after the id apply to
 *   it (`exit: 1`, `reports: none`). A block without a marker is a project of its own.
 * - `<!-- output: <project> -->` blocks hold `$ <command>` lines, each followed by the `[probara]`
 *   lines it logs (the stdout of a `probara` command with `stream: stdout`); `<!-- sent: <project>
 *   -->` blocks hold the JSON entries Probara receives, as a subset of each; `<!-- files: <project>
 *   -->` blocks list the files uploaded (`<name> <content type>`, any order). They take a
 *   `scenario`.
 * - `<!-- not-run: <reason> -->` exempts a block that is not an example of the reporter.
 */
import { fencedBlocks, type FencedBlock } from './markdown.js';

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

/** A project a page's code blocks make. */
export interface DocProject {
  id: string;
  where: string;
  /** Path in the project → content; the default files are laid out first. */
  files: Map<string, string>;
  /** Whether the blocks hold test files: the default tests are then left out. */
  ownTests: boolean;
  /** The exit code of the test command (`exit:`), 0 by default. */
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

/** `<!-- files: <project> -->`: the files uploaded, one `<name> <content type>` per line. */
export interface FilesExample {
  where: string;
  project: string;
  scenario: string;
  files: string[];
}

export interface Page {
  projects: DocProject[];
  outputs: OutputExample[];
  sent: SentExample[];
  files: FilesExample[];
  notRun: { where: string; reason: string }[];
  problems: string[];
}

/** Where a code block goes in its project, or why it cannot go anywhere. */
export type Placement = { path: string; content: string } | { error: string };

/** What a reporter's harness decides about the code blocks of its pages. */
export interface PageRules {
  /** The languages whose blocks are files of a project (`ts`, `js`...). */
  languages: ReadonlySet<string>;
  /** Where a block goes; `undefined` leaves it out (a JSON snippet that is no file). */
  place(block: FencedBlock): Placement | undefined;
  /** Whether a path of a project is a test file. */
  isTestFile(path: string): boolean;
}

/** The project every example without its own files falls back to. */
export const DEFAULT_PROJECT = 'default';

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

/** Every example of a page, by `rules`: `file` names it in messages (`docs/steps.md`). */
export function readPage(file: string, text: string, rules: PageRules): Page {
  const page: Page = { projects: [], outputs: [], sent: [], files: [], notRun: [], problems: [] };
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
    if (marker?.name === 'files') {
      page.files.push({
        where,
        project: marker.value,
        scenario: marker.settings.scenario ?? '',
        files: block.content.split('\n').filter((line) => line.trim() !== ''),
      });
      references.push({ where, project: marker.value, what: 'files' });
      continue;
    }
    if (!rules.languages.has(block.lang)) continue;

    const place = rules.place(block);
    if (place === undefined) continue;
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
    if (rules.isTestFile(place.path)) project.ownTests = true;
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

/** A command line of the docs: which tool it runs (or `install`, `other`) and its arguments. */
export interface Command {
  kind: string;
  args: string[];
  assignments: [string, string][];
}

/** `npm i`, `npm ci`, `pnpm add`, `yarn install`...: a package install, which the docs skip. */
export function isPackageInstall(words: readonly string[]): boolean {
  const [first, second] = words;
  if (first === 'npm') return ['i', 'install', 'ci', 'add'].includes(second ?? '');
  if (first === 'pnpm' || first === 'yarn') return ['i', 'install', 'add'].includes(second ?? '');
  return false;
}

/**
 * A test whether a line runs `tool` or the `probara` CLI, even inside `$(...)`, never matching a
 * package name (`@probara/jest-reporter`) or a file (`jest.config.js`).
 */
export function mentionsToolOf(tool: string): (line: string) => boolean {
  const pattern = new RegExp(
    `(?:^|[\\s"'(=])(?:${tool}|probara|@probara\\/cli(?:@\\S+)?)(?=\\s|$|\\))`,
  );
  return (line) => pattern.test(line);
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
