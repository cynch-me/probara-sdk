/** The files of the command line: paths, directories and globs, then the results of JUnit files. */
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { TestResultInput } from '@probara/core';
import { glob } from 'tinyglobby';
import type { JUnitDialect } from './junit/dialects.js';
import { junitToResults } from './junit/to-results.js';

export interface MatchedFiles {
  /** Absolute paths, once each: in the order of the patterns, sorted within each. */
  files: string[];
  /** Patterns that matched nothing. */
  unmatched: string[];
  /** Patterns that are directories, when directories are not expanded (`directoryGlob: false`). */
  directories: string[];
}

export interface MatchOptions {
  /** The files a directory stands for, beneath it; `false` lists it in `directories` instead. */
  directoryGlob?: string | false;
  /** The order of the files one pattern matches. Defaults to code units. */
  compare?: (a: string, b: string) => number;
}

function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A path as a stem, a sibling number (`-2`; 1 without one) and an extension. */
function siblingKey(path: string): { stem: string; number: number; extension: string } {
  const extension = extname(path);
  const stem = path.slice(0, path.length - extension.length);
  const numbered = /^(.*)-(\d+)$/.exec(stem);
  return numbered === null
    ? { stem, number: 1, extension }
    : { stem: numbered[1] ?? '', number: Number(numbered[2]), extension };
}

/**
 * Results files in the order they were written: a file, then its siblings by number (`x.json`,
 * `x-2.json`, `x-10.json`), other names by code units.
 */
export function bySiblingNumber(a: string, b: string): number {
  const first = siblingKey(a);
  const second = siblingKey(b);
  return (
    byCodeUnits(first.stem, second.stem) ||
    first.number - second.number ||
    byCodeUnits(first.extension, second.extension) ||
    byCodeUnits(a, b)
  );
}

async function kindOf(path: string): Promise<'file' | 'directory' | undefined> {
  try {
    const stats = await stat(path);
    return stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : undefined;
  } catch {
    return undefined;
  }
}

async function filesOf(
  pattern: string,
  cwd: string,
  { directoryGlob, compare }: Required<MatchOptions>,
): Promise<string[] | 'directory'> {
  const path = resolve(cwd, pattern);
  const kind = await kindOf(path);
  if (kind === 'file') return [path];
  const options = { absolute: true, dot: false, onlyFiles: true, expandDirectories: false };
  let found: string[];
  if (kind === 'directory') {
    if (directoryGlob === false) return 'directory';
    found = await glob(directoryGlob, { ...options, cwd: path });
  } else {
    found = await glob(pattern, { ...options, cwd });
  }
  return found.map((file) => resolve(file)).sort(compare);
}

/**
 * Expands each pattern: an existing file, a directory (every `*.xml` beneath it, or what
 * `directoryGlob` says) or a glob.
 */
export async function matchFiles(
  patterns: readonly string[],
  cwd: string,
  { directoryGlob = '**/*.xml', compare = byCodeUnits }: MatchOptions = {},
): Promise<MatchedFiles> {
  const files: string[] = [];
  const seen = new Set<string>();
  const unmatched: string[] = [];
  const directories: string[] = [];
  for (const pattern of patterns) {
    const found = await filesOf(pattern, cwd, { directoryGlob, compare });
    if (found === 'directory') {
      directories.push(pattern);
      continue;
    }
    if (found.length === 0) unmatched.push(pattern);
    for (const file of found) {
      if (seen.has(file)) continue;
      seen.add(file);
      files.push(file);
    }
  }
  return { files, unmatched, directories };
}

/** Whether a relative path leaves its base: `..` or `../x`, never a name like `..reports`. */
function isOutside(path: string): boolean {
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
}

/** How a file is named in logs and output: relative to `cwd` when inside it. */
export function displayPath(file: string, cwd: string): string {
  const path = relative(cwd, file);
  return path === '' || isOutside(path) ? file : path;
}

export interface LoadedReport {
  /** The path as logs and output name it. */
  path: string;
  dialect: JUnitDialect;
  results: TestResultInput[];
  warnings: string[];
}

export interface LoadOptions {
  cwd: string;
  dialect?: JUnitDialect | undefined;
  projectCodes?: readonly string[] | undefined;
  errorStatus?: 'failed' | 'blocked' | undefined;
  attachOutput?: boolean | undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reads and converts every file; `errors` names each file that could not be read or parsed. */
export async function loadReports(
  files: readonly string[],
  options: LoadOptions,
): Promise<{ reports: LoadedReport[]; errors: string[] }> {
  const reports: LoadedReport[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const path = displayPath(file, options.cwd);
    let xml: string;
    try {
      xml = await readFile(file, 'utf8');
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      errors.push(
        `${path}: could not be read (${typeof code === 'string' ? code : messageOf(error)})`,
      );
      continue;
    }
    try {
      const conversion = junitToResults(xml, {
        filePath: path,
        cwd: options.cwd,
        dialect: options.dialect,
        projectCodes: options.projectCodes,
        errorStatus: options.errorStatus,
        attachOutput: options.attachOutput,
      });
      reports.push({ path, ...conversion });
    } catch (error) {
      // A JUnitParseError already names the file.
      const message = messageOf(error);
      errors.push(message.startsWith(`${path}: `) ? message : `${path}: ${message}`);
    }
  }
  return { reports, errors };
}
