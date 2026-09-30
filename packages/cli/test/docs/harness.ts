/**
 * Runs what the docs show against the real CLI (in-process `main`) and the fake Probara: command
 * lines of code blocks, output blocks and XML examples.
 */
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { main } from '../../src/main.js';
import { FIXTURES_DIR } from '../fixtures.js';
import type { FakeProbara } from '@probara/test-support/fake-probara';
import { TOKEN } from '../support/run-cli.js';
import type { FencedBlock } from './markdown.js';
import { mentionsProbara, parseLine, probaraArgs, splitAssignments } from './shell.js';

/**
 * Where the examples expect their reports, and the fixture copied there. Every path a documented
 * command line reads must be listed here.
 */
export const WORKSPACE_FILES: Readonly<Record<string, string>> = {
  'junit.xml': 'jest/junit.xml',
  'reports/junit.xml': 'jest/junit-add-file-attribute.xml',
  'reports/pytest.xml': 'pytest/junit.xml',
  'reports/playwright.xml': 'playwright/junit.xml',
  'reports/test-results': 'playwright/test-results',
  'reports/go.xml': 'gotestsum/junit.xml',
  'target/surefire-reports': 'surefire/surefire-reports-phrased',
  'shards/shard-1/junit.xml': 'jest/junit.xml',
  'shards/shard-2/junit.xml': 'jest/junit-add-file-attribute.xml',
};

/** Files of the troubleshooting examples: what they are about, not tool output. */
const WORKSPACE_TEXTS: Readonly<Record<string, string>> = {
  'broken.xml': '<testsuites><testsuite name="cart"><testcase name="adds"></testsuite>\n',
  'empty.xml': '<testsuites/>\n',
  'attachments/cart.xml': [
    '<testsuites>',
    '  <testsuite name="checkout">',
    '    <testcase classname="checkout.CartTest" name="shows the cart" time="1.2">',
    '      <system-out>[[ATTACHMENT|logs/cart.log]]</system-out>',
    '    </testcase>',
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n'),
};

/**
 * `probara-results.json`: the results of `junit.xml`, written by the CLI itself with reporting off
 * (tool output, like the fixtures), for the `import results` examples.
 */
async function writeResultsFile(dir: string): Promise<void> {
  const quiet = { write: () => undefined };
  const exitCode = await main(
    ['import', 'junit', 'junit.xml', '--results-file', 'probara-results.json'],
    {
      env: { PROBARA_ENABLED: 'false', PROBARA_PROJECT: 'SHOP' },
      cwd: dir,
      stdout: quiet,
      stderr: quiet,
      now: () => NOW,
    },
  );
  if (exitCode !== 0) throw new Error(`could not write probara-results.json (exit ${exitCode})`);
}

/** A temporary folder laid out like the project of the examples. */
export async function createWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'probara-docs-'));
  for (const [path, fixture] of Object.entries(WORKSPACE_FILES)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await cp(join(FIXTURES_DIR, fixture), join(dir, path), { recursive: true });
  }
  for (const [path, text] of Object.entries(WORKSPACE_TEXTS)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  await writeResultsFile(dir);
  return dir;
}

/** The fixed clock of every documented run: run names and dates do not depend on the day. */
export const NOW = new Date('2026-09-29T14:05:00Z');

/** The environment of a configured job: the token is the fake's, the project `SHOP`. */
export function baseEnv(): Record<string, string | undefined> {
  return { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP' };
}

export interface ProbaraRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** stdout and stderr in the order they were written, like a terminal shows them. */
  combined: string;
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** The run ULIDs a command line names: they exist in Probara, so the fake knows them too. */
function seedNamedRuns(
  args: readonly string[],
  env: Record<string, string | undefined>,
  fake: FakeProbara,
): void {
  const named: string[] = [];
  args.forEach((arg, index) => {
    if (arg === '--run-ulid') named.push(args[index + 1] ?? '');
    else if (arg.startsWith('--run-ulid=')) named.push(arg.slice('--run-ulid='.length));
  });
  if (env.PROBARA_RUN_ULID !== undefined) named.push(env.PROBARA_RUN_ULID);
  for (const ulid of named.map((value) => value.trim().toUpperCase())) {
    if (ULID.test(ulid) && fake.run(ulid) === undefined) {
      fake.seedRun({ ulid, projectId: env.PROBARA_PROJECT ?? 'SHOP' });
    }
  }
}

/**
 * Runs `probara <args>` in `cwd`. Every request goes to the fake, whatever base URL the command
 * names, so an example with `--base-url https://probara.example.com` never leaves the machine.
 */
export async function runProbara(
  args: readonly string[],
  { env, cwd, fake }: { env: Record<string, string | undefined>; cwd: string; fake: FakeProbara },
): Promise<ProbaraRun> {
  seedNamedRuns(args, env, fake);
  let stdout = '';
  let stderr = '';
  let combined = '';
  const redirect: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return fetch(`${fake.baseUrl}${url.pathname}${url.search}`, init);
  };
  const exitCode = await main(args, {
    env,
    cwd,
    stdout: {
      write: (text: string) => {
        stdout += text;
        combined += text;
      },
    },
    stderr: {
      write: (text: string) => {
        stderr += text;
        combined += text;
      },
    },
    fetch: redirect,
    sleep: () => Promise.resolve(),
    now: () => NOW,
  });
  return { exitCode, stdout, stderr, combined };
}

/** What varies from run to run: ULIDs, UUIDs, dates, times, delays and the fake's port. */
export function normalize(text: string, fake?: FakeProbara): string {
  return (fake === undefined ? text : text.replaceAll(fake.baseUrl, 'https://app.probara.net'))
    .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, '<ULID>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<UUID>')
    .replace(
      /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?/g,
      '<DATE>',
    )
    .replace(/\b\d+ ms\b/g, '<N> ms');
}

export interface Invocation {
  /** 1-based line in the Markdown file. */
  line: number;
  text: string;
  args: string[];
  expected: number;
  exitCode: number;
  output: string;
}

const EXIT_ANNOTATION = /\s*(?:#|\/\/)\s*exit\s+(\d+)\s*$/;

/**
 * The shell command of a code line: YAML keys (`run:`, `script:`, `- `), Groovy `sh '...'` and
 * comments are taken off. `undefined` for a line that holds no command.
 */
export function shellLineOf(raw: string): string | undefined {
  let line = raw.trim().replace(EXIT_ANNOTATION, '');
  if (line === '' || line.startsWith('#') || line.startsWith('//')) return undefined;
  line = line.replace(/^-\s+/, '');
  line = line.replace(/^(?:run|script|command|cmd):\s*/, '');
  const groovy = /^(?:sh|bat)\s+(['"])(.*)\1\s*$/.exec(line);
  if (groovy !== null) line = groovy[2] ?? '';
  if (line === '' || /^[|>][-+]?$/.test(line)) return undefined;
  return line;
}

/** The lines of a block with `\` continuations joined, each with its first Markdown line. */
function logicalLines(block: FencedBlock): { line: number; text: string }[] {
  const lines: { line: number; text: string }[] = [];
  let pending: { line: number; text: string } | undefined;
  block.content.split('\n').forEach((text, index) => {
    const line = block.line + 1 + index;
    const current =
      pending === undefined
        ? { line, text }
        : { ...pending, text: `${pending.text} ${text.trim()}` };
    if (/\\\s*$/.test(current.text)) {
      pending = { ...current, text: current.text.replace(/\\\s*$/, '') };
    } else {
      pending = undefined;
      lines.push(current);
    }
  });
  if (pending !== undefined) lines.push(pending);
  return lines;
}

/** Languages whose blocks hold commands to run. */
export const COMMAND_LANGUAGES: ReadonlySet<string> = new Set([
  'bash',
  'sh',
  'shell',
  'yaml',
  'yml',
  'groovy',
]);

/**
 * Runs every command line of a block in order, like one job: `export` and assignments carry over
 * to later lines, and `$(probara ...)` substitutes the command's stdout.
 *
 * In CI files a run ULID reaches `probara run close` through the pipeline (job outputs,
 * artifacts), which this does not model: a close with no ULID gets a seeded open run.
 */
export async function runBlock(
  block: FencedBlock,
  { cwd, fake }: { cwd: string; fake: FakeProbara },
): Promise<Invocation[]> {
  const env = baseEnv();
  const invocations: Invocation[] = [];

  async function invoke(args: string[], lineEnv: Record<string, string | undefined>) {
    const runEnv = { ...lineEnv };
    if (
      args[0] === 'run' &&
      args[1] === 'close' &&
      !args.some((arg) => arg.startsWith('--run-ulid'))
    ) {
      if ((runEnv.PROBARA_RUN_ULID ?? '').trim() === '')
        runEnv.PROBARA_RUN_ULID = fake.seedRun({ projectId: runEnv.PROBARA_PROJECT ?? 'SHOP' });
    }
    return runProbara(args, { env: runEnv, cwd, fake });
  }

  for (const { line, text } of logicalLines(block)) {
    const shell = shellLineOf(text);
    if (shell === undefined) continue;
    const isAssignment = /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=/.test(shell);
    if (!mentionsProbara(shell) && !isAssignment) continue;
    const expected = Number(EXIT_ANNOTATION.exec(text)?.[1] ?? '0');
    let ran = false;

    const parsed = await parseLine(shell, env, async (inner) => {
      const words = (await parseLine(inner, env, () => Promise.resolve(''))).words;
      const { assignments, command } = splitAssignments(words);
      const args = probaraArgs(command);
      if (args === undefined) return '';
      ran = true;
      const result = await invoke(args, { ...env, ...Object.fromEntries(assignments) });
      invocations.push({
        line,
        text: inner,
        args,
        expected: 0,
        exitCode: result.exitCode,
        output: result.combined,
      });
      return result.stdout;
    });

    const words = parsed.words[0] === 'export' ? parsed.words.slice(1) : parsed.words;
    const { assignments, command } = splitAssignments(words);
    const args = probaraArgs(command);
    if (command.length === 0) {
      for (const [name, value] of assignments) {
        // The fake only accepts its own token.
        if (name !== 'PROBARA_API_TOKEN') env[name] = value;
      }
    } else if (args !== undefined) {
      ran = true;
      const lineEnv = {
        ...env,
        ...Object.fromEntries(assignments.filter(([name]) => name !== 'PROBARA_API_TOKEN')),
      };
      const result = await invoke(args, lineEnv);
      invocations.push({
        line,
        text: shell,
        args,
        expected,
        exitCode: result.exitCode,
        output: result.combined,
      });
    }
    if (mentionsProbara(shell) && !ran) {
      throw new Error(
        `Line ${line} mentions probara but runs no command the docs tests know: ${shell}`,
      );
    }
  }
  return invocations;
}
