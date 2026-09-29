/**
 * Just enough of a POSIX shell to run the command lines of the docs: words with single and double
 * quotes, backslashes, `$VAR` / `${VAR}` expansion and `$(...)` substitution. A line ends at the
 * first unquoted `|`, `&`, `;`, `<`, `>` or comment; what comes after is not run.
 */

export interface ParsedLine {
  words: string[];
  /** Whether the line ended at an operator (`|`, `&&`, `>`...) rather than at its end. */
  truncated: boolean;
}

export type Substitute = (command: string) => Promise<string>;

const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*/;

/** The index of the `)` that closes the `$(` opened just before `start`. */
function closingParen(text: string, start: number): number {
  let depth = 1;
  let quote: string | undefined;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unclosed $( in: ${text}`);
}

/** Splits one command line into words, expanding variables from `env` and running `$(...)`. */
export async function parseLine(
  line: string,
  env: Readonly<Record<string, string | undefined>>,
  substitute: Substitute,
): Promise<ParsedLine> {
  const words: string[] = [];
  let word = '';
  let inWord = false;
  let quote: "'" | '"' | undefined;
  let index = 0;

  /** Expands `$...` at `index` (just after the `$`), appending to `word`. */
  async function dollar(): Promise<void> {
    const rest = line.slice(index);
    if (rest.startsWith('(')) {
      const end = closingParen(line, index + 1);
      word += (await substitute(line.slice(index + 1, end))).replace(/\n+$/, '');
      index = end + 1;
      return;
    }
    const braced = /^\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(rest);
    const name = braced?.[1] ?? VARIABLE.exec(rest)?.[0];
    if (name === undefined) {
      word += '$';
      return;
    }
    word += env[name] ?? '';
    index += braced === null ? name.length : name.length + 2;
  }

  while (index < line.length) {
    const char = line[index] ?? '';
    if (quote === "'") {
      index += 1;
      if (char === "'") quote = undefined;
      else word += char;
      continue;
    }
    if (quote === '"') {
      index += 1;
      if (char === '"') quote = undefined;
      else if (char === '\\' && /["\\$`]/.test(line[index] ?? '')) {
        word += line[index] ?? '';
        index += 1;
      } else if (char === '$') await dollar();
      else word += char;
      continue;
    }
    if (/\s/.test(char)) {
      if (inWord) words.push(word);
      word = '';
      inWord = false;
      index += 1;
      continue;
    }
    if (/[|&;<>]/.test(char) || (char === '#' && !inWord)) {
      if (inWord) words.push(word);
      return { words, truncated: char !== '#' };
    }
    inWord = true;
    index += 1;
    if (char === "'" || char === '"') quote = char;
    else if (char === '\\') {
      word += line[index] ?? '';
      index += 1;
    } else if (char === '$') await dollar();
    else word += char;
  }
  if (quote !== undefined) throw new Error(`Unclosed ${quote} in: ${line}`);
  if (inWord) words.push(word);
  return { words, truncated: false };
}

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;

/** `NAME=value` words at the start of a command, and the words after them. */
export function splitAssignments(words: readonly string[]): {
  assignments: [string, string][];
  command: string[];
} {
  const assignments: [string, string][] = [];
  let index = 0;
  for (; index < words.length; index += 1) {
    const match = ASSIGNMENT.exec(words[index] ?? '');
    if (match === null) break;
    assignments.push([match[1] ?? '', match[2] ?? '']);
  }
  return { assignments, command: words.slice(index) };
}

/**
 * The ways the docs run the CLI: the published package, the bin on the PATH, and the build of a
 * checkout. Returns the arguments after the executable, or `undefined` for another command.
 */
export function probaraArgs(command: readonly string[]): string[] | undefined {
  const [first, second, third] = command;
  // `@probara/cli` or a pinned `@probara/cli@0.1.0`.
  const isPackage = (word: string | undefined) =>
    word !== undefined && /^@probara\/cli(?:@\S+)?$/.test(word);
  if (first === 'probara') return command.slice(1);
  if (first === 'npx' && isPackage(second)) return command.slice(2);
  if (first === 'npx' && second === '--yes' && isPackage(third)) return command.slice(3);
  if (first === 'pnpm' && second === 'exec' && third === 'probara') return command.slice(3);
  if (first === 'node' && second?.endsWith('packages/cli/dist/cli.js') === true) {
    return command.slice(2);
  }
  return undefined;
}

/** Whether a line mentions a way of running the CLI anywhere, even inside `$(...)`. */
export function mentionsProbara(line: string): boolean {
  return /(?:^|[\s"'(=])(?:probara|npx (?:--yes )?@probara\/cli(?:@\S+)?|node \S*packages\/cli\/dist\/cli\.js)(?=\s|$|\))/.test(
    line,
  );
}
