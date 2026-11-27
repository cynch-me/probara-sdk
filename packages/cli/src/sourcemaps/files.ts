/** The built JavaScript files under the directories of a command, each with its source map. */
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { UsageError } from '../options.js';

const JAVASCRIPT = /\.(?:m|c)?js$/;
/** The last `//# sourceMappingURL=` comment of a file. */
const MAP_URL = /^\/\/[#@] sourceMappingURL=(\S+)[ \t]*\r?$/gm;

export interface BuiltFile {
  /** Absolute paths of the file and of its map. */
  path: string;
  mapPath: string;
  /** Both as the log shows them: from the current directory, with `/`. */
  shown: string;
  mapShown: string;
  /** The path of the file from the directory it was found under, with `/`: its URL path. */
  urlPath: string;
}

const posix = (path: string) => path.split(sep).join('/');

async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    (stats) => stats.isFile(),
    () => false,
  );
}

/** The map of `path`: the one its sourceMappingURL comment names, else `<file>.map` beside it. */
async function mapOf(path: string): Promise<string | undefined> {
  const code = await readFile(path, 'utf8');
  const url = [...code.matchAll(MAP_URL)].at(-1)?.[1];
  if (url !== undefined && !url.startsWith('data:') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    let named: string | undefined;
    try {
      named = resolve(dirname(path), decodeURIComponent(url.replace(/[?#].*$/, '')));
    } catch {
      named = undefined;
    }
    if (named !== undefined && (await isFile(named))) return named;
  }
  const sibling = `${path}.map`;
  return (await isFile(sibling)) ? sibling : undefined;
}

/**
 * The .js, .mjs and .cjs files with a source map under each of `dirs` (relative to `cwd`), in path
 * order.
 *
 * @throws UsageError when a directory is missing, or none of them holds such a file.
 */
export async function builtFilesUnder(
  dirs: readonly string[],
  cwd: string,
  command: string,
): Promise<BuiltFile[]> {
  if (dirs.length === 0) {
    throw new UsageError('The directory of the built files is missing', `probara ${command}`);
  }
  const found: BuiltFile[] = [];
  for (const dir of dirs) {
    const root = resolve(cwd, dir);
    let entries;
    try {
      entries = await readdir(root, { recursive: true, withFileTypes: true });
    } catch {
      throw new UsageError(`${dir} is not a directory`, `probara ${command}`);
    }
    const paths = entries
      .filter((entry) => entry.isFile() && JAVASCRIPT.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name))
      .sort();
    for (const path of paths) {
      const mapPath = await mapOf(path);
      if (mapPath === undefined) continue;
      found.push({
        path,
        mapPath,
        shown: posix(relative(cwd, path)),
        mapShown: posix(relative(cwd, mapPath)),
        urlPath: posix(relative(root, path)),
      });
    }
  }
  if (found.length === 0) {
    throw new UsageError(
      `${dirs.join(', ')} ${dirs.length === 1 ? 'holds' : 'hold'} no .js, .mjs or .cjs file with a source map`,
      `probara ${command}`,
    );
  }
  return found;
}
