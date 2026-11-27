/** The built JavaScript files under the directories of a command, each with its source map. */
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { UsageError } from '../options.js';
import { builtFileAt, JAVASCRIPT, type BuiltFile } from './built-file.js';

export type { BuiltFile } from './built-file.js';

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
      const file = await builtFileAt(path, root, cwd);
      if (file !== undefined) found.push(file);
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
