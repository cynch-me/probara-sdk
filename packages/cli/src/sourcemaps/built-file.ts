/** A built JavaScript file with its source map, wherever it was found. */
import { readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

export const JAVASCRIPT = /\.(?:m|c)?js$/;
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
 * The JavaScript file at `path` (absolute) with its map, its URL path taken from `root` and its
 * shown paths from `cwd`; none when it is not a .js, .mjs or .cjs file with a map.
 */
export async function builtFileAt(
  path: string,
  root: string,
  cwd: string,
): Promise<BuiltFile | undefined> {
  if (!JAVASCRIPT.test(path) || !(await isFile(path))) return undefined;
  const mapPath = await mapOf(path);
  if (mapPath === undefined) return undefined;
  return {
    path,
    mapPath,
    shown: posix(relative(cwd, path)),
    mapShown: posix(relative(cwd, mapPath)),
    urlPath: posix(relative(root, path)),
  };
}
