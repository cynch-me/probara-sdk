/**
 * Browser mode in real Vitest, on every supported major (V10): Playwright's Chromium, headless. The shared tests of
 * `fixtures/browser` run on Node and in the browser, and both runs must send the same keys, statuses, helper data and
 * files. The browser-only tests check Vite's file access, the concurrent helpers, the console and a failure screenshot.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM_INSTALL_COMMAND, missingChromiumMessage } from './support/browser.js';
import { buildReporter } from './support/reporter-build.js';
import {
  createWorkspace,
  probaraEnv,
  TOKEN,
  VITEST_VERSIONS,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 300_000;
const SHARED = 'tests/shared.test.ts';

/** Every result the fake received, in the order they were sent. */
function sentOf(probara: FakeProbara) {
  return probara.reports().flatMap((report) => report.results);
}

type Sent = ReturnType<typeof sentOf>;

/** The automation key of a test of the fixture: its file, then its title. */
function keyOf(file: string, title: string): string {
  return `${file} > ${title}`;
}

/** The parts of the sent results that do not depend on timing, by key: the same on Node and in the browser. */
function projectionOf(results: Sent, file: string) {
  return results
    .filter((result) => String(result.automationKey).startsWith(`${file} > `))
    .map((result) => ({
      key: result.automationKey,
      status: result.status,
      title: result.title,
      parameters: result.parameters,
      steps: (result.steps ?? []).map((step) => step.action),
      caseTags: result.case?.tags,
    }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

/** The name, type and content of every staged file, sorted. */
function filesOf(probara: FakeProbara): string[] {
  return probara
    .stagedFiles()
    .map(({ name, type, sha256 }) => `${name} ${type} ${sha256}`)
    .sort();
}

/** How many times `text` appears in the output of a run. */
function occurrences(run: CommandRun, text: string): number {
  return (run.stdout + run.stderr).split(text).length - 1;
}

describe('the browser mode messages', () => {
  it('names the install command when Playwright has no Chromium, and says nothing otherwise', () => {
    const message = missingChromiumMessage(
      "browserType.launch: Executable doesn't exist at /cache/chrome-headless-shell",
    );
    expect(message).toContain(CHROMIUM_INSTALL_COMMAND);
    expect(missingChromiumMessage('Test Files 1 passed (1)')).toBeUndefined();
  });
});

describe.each(VITEST_VERSIONS)('browser mode on $name', (vitest) => {
  let workspace: Workspace;
  let outside: string;
  let outsideFile: string;
  const fakes: FakeProbara[] = [];
  let node: FakeProbara;
  let browser: FakeProbara;
  let nodeRun: CommandRun;
  let browserRun: CommandRun;

  beforeAll(async () => {
    await buildReporter();
    workspace = await createWorkspace(vitest, 'browser', { browser: true });
    // A folder beside the project, which Vite does not serve: a file there must not reach the browser's attachments.
    // The browser fixture attaches this file by the path the test writes into it (`tests/outside-file.ts`), so the
    // refusal names the planted file, and a run that copied it would fail the test.
    outside = `${workspace.dir}-outside`;
    outsideFile = join(outside, 'receipt.txt');
    await mkdir(outside, { recursive: true });
    await writeFile(outsideFile, 'outside the project');
    await writeFile(
      join(workspace.dir, 'tests', 'outside-file.ts'),
      `export const OUTSIDE_FILE = ${JSON.stringify(outsideFile)};\n`,
    );
    node = await startFakeProbara({ token: TOKEN });
    browser = await startFakeProbara({ token: TOKEN });
    fakes.push(node, browser);
    nodeRun = await workspace.vitest(
      ['run', '--config', 'node.config.mts'],
      probaraEnv(node.baseUrl),
    );
    const config = vitest.name === 'Vitest 3' ? 'browser-3.config.mts' : 'browser.config.mts';
    browserRun = await workspace.vitest(
      ['run', '--config', config],
      probaraEnv(browser.baseUrl, { PROBARA_CAPTURE_OUTPUT: 'true' }),
    );
    // A run without Chromium fails here, with the install command, and is never skipped.
    const missing = missingChromiumMessage(browserRun.stdout + browserRun.stderr);
    if (missing !== undefined) throw new Error(missing);
  }, TIMEOUT);

  afterAll(async () => {
    await Promise.all(fakes.map((fake) => fake.close()));
    await rm(outside, { recursive: true, force: true });
    await workspace.remove();
  });

  it('sends the shared tests with the keys, statuses and attempts the Node run sends', () => {
    // The Node run's tests all pass (the retry passes); the browser run has one deliberate failure.
    expect(nodeRun.exitCode).toBe(0);
    expect(browserRun.exitCode).toBe(1);
    const onNode = projectionOf(sentOf(node), SHARED).map(({ key, status }) => `${key} ${status}`);
    const inBrowser = projectionOf(sentOf(browser), SHARED).map(
      ({ key, status }) => `${key} ${status}`,
    );
    expect(onNode.length).toBeGreaterThan(0);
    expect(inBrowser).toEqual(onNode);
  });

  it('sends the helper data of the shared tests as the Node run does', () => {
    // The key drops the case id of the title (SHOP-41), as the JUnit import does.
    const totals = keyOf(SHARED, 'totals the cart');
    const inBrowser = projectionOf(sentOf(browser), SHARED).find((entry) => entry.key === totals);
    const onNode = projectionOf(sentOf(node), SHARED).find((entry) => entry.key === totals);
    expect(inBrowser).toBeDefined();
    expect(inBrowser).toEqual(onNode);
    expect(inBrowser?.parameters).toEqual({ region: 'eu' });
    expect(inBrowser?.steps).toEqual(['Add the item']);
    expect(inBrowser?.caseTags).toEqual(['smoke']);
  });

  it('retries a browser test: the failed attempt and the passed one are two results', () => {
    const retried = sentOf(browser).filter(
      (result) => result.automationKey === keyOf(SHARED, 'retries the check until it passes'),
    );
    expect(retried.map((result) => result.status)).toEqual(['failed', 'passed']);
    expect(retried[1]?.parameters).toMatchObject({ attempt: '2' });
  });

  it('sends the body and the file of the shared test, with the same bytes as the Node run', () => {
    // The copies keep the names of the attachments, with the extension a body or a file has.
    const named = /^(note\.txt|receipt\.txt) /u;
    const inBrowser = filesOf(browser).filter((line) => named.test(line));
    expect(inBrowser.length).toBe(2);
    expect(inBrowser).toEqual(filesOf(node).filter((line) => named.test(line)));
  });

  it('leaves out a file outside the folders Vite serves, with a warning, and sends no copy of it', () => {
    // The warning names the planted file: a warning about another path would not prove this refusal.
    expect(browserRun.stdout + browserRun.stderr).toContain(
      `probara.attach() did not attach "outside": Vite does not serve "${outsideFile}"`,
    );
    expect(filesOf(browser).some((line) => line.startsWith('outside '))).toBe(false);
    expect(filesOf(browser)).not.toContainEqual(expect.stringContaining('outside the project'));
  });

  it('warns once that a concurrent test cannot attribute its helper, and drops the helper', () => {
    const warning = 'probara.comment() is dropped in a concurrent test';
    expect(occurrences(browserRun, warning)).toBe(1);
    const concurrent = sentOf(browser).find((result) =>
      String(result.automationKey).endsWith(
        'is a concurrent test whose helper cannot be attributed',
      ),
    );
    expect(concurrent).toBeDefined();
    expect(JSON.stringify(concurrent)).not.toContain('written by a concurrent test');
  });

  it('sends the console output of a browser test as stdout.log', () => {
    const logged = filesOf(browser).filter((line) => line.startsWith('stdout.log '));
    expect(logged.length).toBe(1);
  });

  it('attaches the failure screenshot of a failed browser test', () => {
    const failed = sentOf(browser).find((result) =>
      String(result.automationKey).endsWith('fails, so that Vitest takes a screenshot of the page'),
    );
    expect(failed?.status).toBe('failed');
    expect(filesOf(browser).some((line) => /\.png image\/png /.test(line))).toBe(true);
  });
});
