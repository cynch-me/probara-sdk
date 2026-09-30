/** The JUnit files of the command line: paths, directories and globs, then their results. */
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { TestResultInput } from '@probara/core';
import { glob } from 'tinyglobby';
import type { JUnitDialect } from './junit/dialects.js';
import { junitToResults } from './junit/to-results.js';

export interface MatchedFiles {
  /** Absolute paths, once each: in the order of the patterns, sorted within each. */
  files: string[];
  /** Patterns that matched nothing. */
  unmatched: string[];
}

function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function kindOf(path: string): Promise<'file' | 'directory' | undefined> {
  try {
    const stats = await stat(path);
    return stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : undefined;
  } catch {
    return undefined;
  }
}

async function filesOf(pattern: string, cwd: string): Promise<string[]> {
  const path = resolve(cwd, pattern);
  const kind = await kindOf(path);
  if (kind === 'file') return [path];
  const options = { absolute: true, dot: false, onlyFiles: true, expandDirectories: false };
  const found =
    kind === 'directory'
      ? await glob('**/*.xml', { ...options, cwd: path })
      : await glob(pattern, { ...options, cwd });
  return found.map((file) => resolve(file)).sort(byCodeUnits);
}

/** Expands each pattern: an existing file, a directory (every `*.xml` beneath it) or a glob. */
export async function matchFiles(patterns: readonly string[], cwd: string): Promise<MatchedFiles> {
  const files: string[] = [];
  const seen = new Set<string>();
  const unmatched: string[] = [];
  for (const pattern of patterns) {
    const found = await filesOf(pattern, cwd);
    if (found.length === 0) unmatched.push(pattern);
    for (const file of found) {
      if (seen.has(file)) continue;
      seen.add(file);
      files.push(file);
    }
  }
  return { files, unmatched };
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
