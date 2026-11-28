/**
 * Runs what the docs show against the real CLI (in-process `main`) and the fake Probara: command
 * lines of code blocks, output blocks and XML examples.
 */
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveSnapSettings, snapNonceOf } from '@probara/core';
import { main } from '../../src/main.js';
import { FIXTURES_DIR } from '../fixtures.js';
import type { FakeProbara } from '@probara/test-support/fake-probara';
import { TOKEN } from '../support/run-cli.js';
import { createFakeVisApi } from '../support/fake-vis.js';
import { startFakeCdp, type FakePage } from '../support/fake-cdp.js';
import type { FencedBlock } from './markdown.js';
import {
  EXIT_ANNOTATION,
  logicalLines,
  mentionsProbara,
  parseLine,
  probaraArgs,
  shellLineOf,
  splitAssignments,
} from '@probara/test-support/docs/shell';

export { COMMAND_LANGUAGES, shellLineOf } from '@probara/test-support/docs/shell';

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
  'reports/vitest.xml': 'vitest/junit-4.1.11.xml',
  'reports/cypress-1a2b3c4d5e6f7a8b.xml': 'cypress-builtin-junit/junit-flaky.xml',
  'reports/cypress-9f8e7d6c5b4a3f21.xml': 'cypress-builtin-junit/junit-root-only.xml',
  'target/surefire-reports': 'surefire/surefire-reports-phrased',
  'shards/shard-1/junit.xml': 'jest/junit.xml',
  'shards/shard-2/junit.xml': 'jest/junit-add-file-attribute.xml',
  features: 'cucumber/source/features',
  'results/cucumber.json': 'cucumber/cucumber.json',
  'recording.webm': 'vis/recording.webm',
  'screenshot.png': 'playwright/source/assets/pixel.png',
  'screenshots/home.png': 'playwright/source/assets/pixel.png',
  'screenshots/checkout/cart.png': 'playwright/source/assets/pixel.png',
  'test-results/checkout/video.webm': 'vis/recording.webm',
  'test-results/checkout/trace.zip': 'vis/trace.zip',
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
  'dist/app.js':
    'function boom(){throw new Error("boom")}boom();\n//# sourceMappingURL=app.js.map\n',
  'dist/app.js.map': `${JSON.stringify({ version: 3, file: 'app.js', sources: ['../src/app.ts'], names: [], mappings: 'AAAA' })}\n`,
};

/**
 * `probara-results.json`: the results of `junit.xml`, written by the CLI itself with reporting off
 * (tool output, like the fixtures), for the `import results` examples. An example that sends
 * everything deletes it, so each block gets it back; the results files an earlier block left go
 * first, or the file would be written to a sibling and a glob would import both.
 */
export async function writeResultsFile(dir: string): Promise<void> {
  for (const entry of await readdir(dir)) {
    if (entry.startsWith('probara-results')) await rm(join(dir, entry), { recursive: true });
  }
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

/** The page a documented `vis record` records, in a fake browser: never a real debugging port. */
const RECORDED_PAGE = {
  id: 'C0FFEE0000000000000000000000CAFE',
  url: 'https://shop.example.com/checkout',
  title: 'Checkout',
};

/** What the recorded page sends: a short checkout session, then the tab closes. */
async function recordCheckout(page: FakePage): Promise<void> {
  const start = 1_790_000_000_000;
  const event = (type: number, at: number, data: object) => ({ type, timestamp: start + at, data });
  page.send({
    kind: 'replay',
    events: [
      event(4, 0, { href: RECORDED_PAGE.url, width: 1280, height: 720 }),
      event(2, 1, { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { top: 0, left: 0 } }),
    ],
  });
  page.send({
    kind: 'environment',
    environment: {
      pageUrl: RECORDED_PAGE.url,
      pageTitle: RECORDED_PAGE.title,
      environment: { browser: { name: 'Chrome', version: '140.0' }, device: 'desktop' },
    },
  });
  page.send({
    kind: 'console',
    entry: { t: 0, ts: start + 500, level: 'error', args: ['Payment failed'] },
  });
  page.send({
    kind: 'network',
    entry: {
      t: 0,
      ts: start + 800,
      id: 'r1',
      kind: 'fetch',
      method: 'POST',
      url: 'https://shop.example.com/api/pay',
      status: 402,
      requestHeaders: {},
      responseHeaders: {},
      requestBody: null,
      responseBody: null,
      durationMs: 12,
      timing: null,
      error: null,
      graphql: null,
    },
  });
  page.send({
    kind: 'events',
    entry: {
      t: 0,
      ts: start + 900,
      type: 'click',
      target: { selector: 'button#pay' },
      url: RECORDED_PAGE.url,
    },
  });
  const move = { source: 1, positions: [{ x: 1, y: 2, id: 1, timeOffset: 0 }] };
  page.send({
    kind: 'replay',
    events: [
      event(3, 1200, move),
      event(4, 3000, { href: RECORDED_PAGE.url, width: 1280, height: 720 }),
      event(2, 3001, {
        node: { type: 0, childNodes: [], id: 1 },
        initialOffset: { top: 0, left: 0 },
      }),
      event(3, 4000, move),
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  page.close();
}

/** `args` with the value of `--cdp` replaced by `url`. */
function withCdp(args: readonly string[], url: string): string[] {
  return args.map((arg, index) => {
    if (arg.startsWith('--cdp=')) return `--cdp=${url}`;
    return args[index - 1] === '--cdp' ? url : arg;
  });
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
  // The Vis endpoints are not in the fake Probara: a fake of them, holding one Vis and one recording
  // link, answers them.
  const visApi = createFakeVisApi({ token: TOKEN });
  visApi.seed({ visNumber: 12 });
  visApi.seedLink({ ulid: '01KC0000000000000000000R1K' });
  const redirect: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (/^\/api\/v1\/(?:vises|vis-recording-links)(?:\/|$)/.test(url.pathname)) {
      return visApi.fetch(input, init);
    }
    return fetch(`${fake.baseUrl}${url.pathname}${url.search}`, init);
  };
  // A documented recording records a fake browser's page, whatever endpoint the line names.
  const browser =
    args[0] === 'vis' && args[1] === 'record'
      ? await startFakeCdp({ pages: [RECORDED_PAGE], onInject: recordCheckout })
      : undefined;
  const exitCode = await main(browser === undefined ? args : withCdp(args, browser.httpUrl), {
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
  await browser?.close();
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

/** The value of `--name value` or `--name=value` in `args`. */
function flagOf(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index !== -1) return args[index + 1];
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

/**
 * What the machines of a split run did before `probara snap finalize`: they joined the build of the
 * name and the nonce the command resolves (one is set when the line and the CI give none), and one
 * of them finalized its shard.
 */
async function seedSnapBuild(
  args: readonly string[],
  env: Record<string, string | undefined>,
  fake: FakeProbara,
): Promise<void> {
  const settings = resolveSnapSettings(
    { snapBuildName: flagOf(args, 'build-name'), snapNonce: flagOf(args, 'nonce') },
    env,
  );
  let ciNonce = snapNonceOf(settings.nonce, env);
  if (ciNonce === undefined) {
    ciNonce = 'pipeline-7';
    env.PROBARA_SNAP_NONCE = ciNonce;
  }
  const builds = `${fake.baseUrl}/api/v1/projects/${env.PROBARA_PROJECT ?? 'SHOP'}/snap/builds`;
  const post = async (url: string, body: unknown): Promise<unknown> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.PROBARA_API_TOKEN ?? ''}`,
      },
      body: JSON.stringify(body),
    });
    return response.json();
  };
  const created = (await post(builds, {
    ...(settings.buildName === undefined ? {} : { name: settings.buildName }),
    commit: 'a'.repeat(40),
    branch: 'main',
    ciNonce,
    files: [],
  })) as { build: { ulid: string }; shardUlid: string };
  await post(`${builds}/${created.build.ulid}/shards/${created.shardUlid}:finalize`, {
    screenshots: [],
  });
}

/**
 * What a `probara snap wait` waits for: the build its name and nonce name (or, without a nonce, of
 * the commit the CI builds, set when the CI gives none), already compared with no changes.
 */
async function seedComparedSnapBuild(
  args: readonly string[],
  env: Record<string, string | undefined>,
  fake: FakeProbara,
): Promise<void> {
  const settings = resolveSnapSettings(
    { snapBuildName: flagOf(args, 'build-name'), snapNonce: flagOf(args, 'nonce') },
    env,
  );
  env.PROBARA_COMMIT ??= 'a'.repeat(40);
  const response = await fetch(
    `${fake.baseUrl}/api/v1/projects/${env.PROBARA_PROJECT ?? 'SHOP'}/snap/builds`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.PROBARA_API_TOKEN ?? ''}`,
      },
      body: JSON.stringify({
        ...(settings.buildName === undefined ? {} : { name: settings.buildName }),
        ...(settings.nonce === undefined ? {} : { ciNonce: settings.nonce }),
        commit: env.PROBARA_COMMIT,
        branch: 'main',
        files: [],
      }),
    },
  );
  const { build } = (await response.json()) as { build: { ulid: string } };
  fake.concludeSnapBuild(build.ulid, { jobStatus: 'complete', conclusion: 'no-changes' });
}

/**
 * Runs every command line of a block in order, like one job: `export` and assignments carry over
 * to later lines, and `$(probara ...)` substitutes the command's stdout.
 *
 * A `probara snap finalize` completes the build the machines of the run sent before it, which this
 * does not model either: the build of its name and nonce is seeded, with one finalized shard. A
 * `probara snap wait` gets that build compared, and a `probara snap upload` the commit and the
 * branch a CI gives.
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
    if (args[0] === 'snap' && args[1] === 'finalize') await seedSnapBuild(args, runEnv, fake);
    if (args[0] === 'snap' && args[1] === 'wait') await seedComparedSnapBuild(args, runEnv, fake);
    if (args[0] === 'snap' && args[1] === 'upload') {
      runEnv.PROBARA_COMMIT ??= 'a'.repeat(40);
      runEnv.PROBARA_BRANCH ??= 'main';
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
