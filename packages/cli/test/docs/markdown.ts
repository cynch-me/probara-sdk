/** The Markdown the docs tests check: which files, their fenced blocks, tables and links. */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root. */
export const REPO_DIR = fileURLToPath(new URL('../../../../', import.meta.url));
/** `packages/cli/`. */
export const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));

function markdownFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return markdownFilesUnder(path);
      return entry.name.endsWith('.md') ? [path] : [];
    })
    .sort();
}

/** The user docs: the package README, its changelog and every page of `docs/`. */
export function userDocs(): string[] {
  return [
    join(PACKAGE_DIR, 'README.md'),
    join(PACKAGE_DIR, 'CHANGELOG.md'),
    ...markdownFilesUnder(join(PACKAGE_DIR, 'docs')),
  ];
}

/**
 * The names of the `*.md` files git tracks at the root of `dir`, or `undefined` when git cannot
 * list them: no git, no checkout (a copy without `.git`), a safe.directory refusal, or a checkout
 * that tracks none there (a copy inside another repository).
 */
export function trackedRootMarkdown(dir: string): string[] | undefined {
  try {
    const names = execFileSync('git', ['ls-files', '-z', '--', '*.md'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\0')
      .filter((name) => name.endsWith('.md') && !name.includes('/'));
    return names.length === 0 ? undefined : names;
  } catch {
    return undefined;
  }
}

/** Whether `path` is a file, following a symlink: false when missing or dangling. */
function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

/** The names of the `*.md` files on disk at the root of `dir`: a symlink counts if it resolves. */
function rootMarkdownOnDisk(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith('.md') && isFile(join(dir, name)));
}

/**
 * The `*.md` files at the root of `dir` (a symlink such as `CLAUDE.md` included), sorted: the ones
 * git tracks, so local notes stay out, or the ones on disk when git cannot list them.
 */
export function rootMarkdownFiles(
  dir: string = REPO_DIR,
  tracked: (dir: string) => string[] | undefined = trackedRootMarkdown,
): string[] {
  return (tracked(dir) ?? rootMarkdownOnDisk(dir)).map((name) => join(dir, name)).sort();
}

/** Every Markdown file whose links are checked: the repository-level files and the user docs. */
export function linkedDocs(): string[] {
  return [...rootMarkdownFiles(), ...userDocs()];
}

/** A path as test names show it: relative to the repository. */
export function shown(path: string): string {
  return relative(REPO_DIR, path);
}

/** Why `path` cannot be read as a file, naming it, or `undefined` when it can. */
export function unreadable(path: string): string | undefined {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (stats === undefined) {
    return `${shown(path)}: no such file (tracked but missing on disk, or a symlink that dangles)`;
  }
  return stats.isFile() ? undefined : `${shown(path)}: not a file`;
}

/** The text of a file; empty when it is not one (the tests check that on their own). */
export function read(path: string): string {
  return isFile(path) ? readFileSync(path, 'utf8') : '';
}

export interface FencedBlock {
  /** The info string's first word, such as `bash`; empty when there is none. */
  lang: string;
  /** The lines between the fences, joined with `\n`, without a final newline. */
  content: string;
  /** 1-based line of the opening fence. */
  line: number;
  /** The text of the HTML comment right before the fence (blank lines allowed), trimmed. */
  marker?: string;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const COMMENT = /^\s*<!--\s*(.*?)\s*-->\s*$/;

/** The fenced code blocks of a Markdown text, in order. */
export function fencedBlocks(text: string): FencedBlock[] {
  const lines = text.split('\n');
  const blocks: FencedBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = FENCE.exec(lines[index] ?? '');
    if (opening === null) continue;
    const fence = opening[1] ?? '```';
    const start = index;
    const content: string[] = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, '') === '') break;
      content.push(line);
    }
    let previous = start - 1;
    while (previous >= 0 && (lines[previous] ?? '').trim() === '') previous -= 1;
    const marker = COMMENT.exec(lines[previous] ?? '')?.[1];
    blocks.push({
      lang: opening[2] ?? '',
      content: content.join('\n'),
      line: start + 1,
      ...(marker === undefined ? {} : { marker }),
    });
  }
  return blocks;
}

/** The text with the lines of its fenced blocks blanked (so line numbers stay). */
export function withoutFences(text: string): string {
  const lines = text.split('\n');
  const blanked = [...lines];
  for (const block of fencedBlocks(text)) {
    const length = block.content === '' ? 0 : block.content.split('\n').length;
    for (let line = block.line - 1; line <= block.line + length; line += 1) blanked[line] = '';
  }
  return blanked.join('\n');
}

/** The text without its fenced blocks and inline code spans, where links are not links. */
export function withoutCode(text: string): string {
  return withoutFences(text).replace(/(`+)[^`]*?\1/g, '');
}

/** The rows of the first table after `<!-- marker -->`, as trimmed cells, without the header. */
export function tableAfter(text: string, marker: string): string[][] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === `<!-- ${marker} -->`);
  if (start === -1) return [];
  const rows: string[][] = [];
  let seenTable = false;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim().startsWith('|')) {
      if (seenTable) break;
      continue;
    }
    seenTable = true;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
    rows.push(cells);
  }
  // The header, then the delimiter row.
  return rows.slice(2);
}

/**
 * The anchor GitHub gives each heading: lowercase, punctuation removed, spaces as `-`, and `-1`,
 * `-2`... on repeats.
 */
export function headingAnchors(text: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  for (const line of withoutFences(text).split('\n')) {
    const heading = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1];
    if (heading === undefined) continue;
    const slug = heading
      .replace(/<[^>]*>/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${count}`);
  }
  for (const line of text.split('\n')) {
    for (const match of line.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) anchors.add(match[1] ?? '');
  }
  return anchors;
}

export interface Link {
  target: string;
  line: number;
}

/** Inline links, images and reference definitions outside code. */
export function linksOf(text: string): Link[] {
  const links: Link[] = [];
  withoutCode(text)
    .split('\n')
    .forEach((line, index) => {
      for (const match of line.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
        links.push({ target: match[1] ?? '', line: index + 1 });
      }
      const definition = /^ {0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/.exec(line);
      if (definition !== null) links.push({ target: definition[1] ?? '', line: index + 1 });
    });
  return links;
}
