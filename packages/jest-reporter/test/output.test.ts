/**
 * `captureOutput` in the real `jest`, in each supported version, against a fake Probara: the setup
 * file attaches each attempt's console output as the Playwright reporter does, in workers and in
 * band (Jest's verbose console), while Jest still prints every message where the test wrote it;
 * one warning without the setup file, and nothing at all from the setup file without the reporter.
 */
import { createHash } from 'node:crypto';
import type { ReportRequest } from '@probara/core';
import {
  startFakeProbara,
  type FakeProbara,
  type FakeStagedFile,
} from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkspace,
  JEST_VERSIONS,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 180_000;
const SETUP_MISSING =
  "[probara] captureOutput needs the setup file: add setupFilesAfterEnv: ['@probara/jest-reporter/setup'] to the Jest config";

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** A captured stream as the fake receives it: its name, type and the SHA-256 of `text`. */
function log(name: 'stdout.log' | 'stderr.log', text: string): string {
  return `${name} text/plain ${sha256(text)}`;
}

/**
 * The files each result was sent with, by the end of its key, one list per attempt in the order
 * they were sent: a report's results are recorded in order, and each upload names its result.
 */
function filesByTest(fake: FakeProbara): Record<string, string[][]> {
  const [run] = fake.runs();
  const entries = fake.reports().flatMap((report: ReportRequest) => report.results);
  const files = new Map<string, string[]>();
  for (const request of fake.requestsTo('stage')) {
    const staged = request.body as FakeStagedFile[];
    const list = files.get(request.resultUlid ?? '') ?? [];
    list.push(...staged.map((file) => `${file.name} ${file.type} ${file.sha256}`));
    files.set(request.resultUlid ?? '', list);
  }
  const byTest: Record<string, string[][]> = {};
  entries.forEach((entry, index) => {
    const test = entry.automationKey?.split(' > ').slice(1).join(' > ') ?? '?';
    (byTest[test] ??= []).push((files.get(run?.results[index] ?? '') ?? []).sort());
  });
  return byTest;
}

const EXPECTED: Record<string, string[][]> = {
  'output prints what it does': [
    [
      log('stderr.log', 'Slow response: 2.1 s\nRetrying\n'),
      log('stdout.log', 'Before each\nOpening the cart\n3 items\n'),
    ],
  ],
  // The output of its hooks is the test's.
  'output prints nothing of its own': [[log('stdout.log', 'Before each\n')]],
  // Every attempt its own.
  'output fails first, then passes': [
    [log('stdout.log', 'Before each\nAttempt 1\n')],
    [log('stdout.log', 'Before each\nAttempt 2\n')],
  ],
  // What a spy silences is neither printed nor captured.
  'output silences the console with a spy': [
    [log('stderr.log', 'After the spy\n'), log('stdout.log', 'Before each\n')],
  ],
  'prints outside any describe': [[log('stdout.log', '{ sku: 42 }\n')]],
  // Jest runs no beforeEach or afterEach for a concurrent test: nothing is captured.
  'runs at once': [[]],
  'prints in a jsdom environment': [[log('stdout.log', 'In the object\n')]],
};

describe.each(JEST_VERSIONS)('captureOutput in $name', (jest) => {
  let workspace: Workspace;
  const fakes: FakeProbara[] = [];
  const runs: Record<'workers' | 'verbose' | 'noSetup' | 'noReporter', CommandRun> = {} as never;

  async function fake(): Promise<FakeProbara> {
    const started = await startFakeProbara({ token: TOKEN });
    fakes.push(started);
    return started;
  }

  beforeAll(async () => {
    workspace = await createWorkspace(jest, 'output');
    runs.workers = await workspace.jest(['--maxWorkers=2'], probaraEnv((await fake()).baseUrl));
    // One process: Jest's verbose console prints each message as it comes.
    runs.verbose = await workspace.jest(
      ['--runInBand', '--verbose'],
      probaraEnv((await fake()).baseUrl),
    );
    runs.noSetup = await workspace.jest(
      ['--config', 'no-setup.config.js'],
      probaraEnv((await fake()).baseUrl),
    );
    runs.noReporter = await workspace.jest(['--reporters', 'default'], {});
  }, TIMEOUT);

  afterAll(async () => {
    await Promise.all(fakes.map((each) => each.close()));
    await workspace.remove();
  });

  it('attaches each attempt its console output as stdout.log and stderr.log, in workers', () => {
    expect(runs.workers.exitCode).toBe(0);
    expect(filesByTest(fakes[0] as FakeProbara)).toEqual(EXPECTED);
    expect(runs.workers.stdout + runs.workers.stderr).not.toContain(TOKEN);
  });

  it("attaches the same with Jest's verbose console, in band", () => {
    expect(runs.verbose.exitCode).toBe(0);
    expect(filesByTest(fakes[1] as FakeProbara)).toEqual(EXPECTED);
  });

  it('still prints every message, under the line of the test that wrote it', () => {
    for (const run of [runs.workers, runs.verbose]) {
      const output = run.stdout + run.stderr;
      for (const message of ['Opening the cart', '3 items', 'Slow response: 2.1 s', 'Attempt 2']) {
        expect(output).toContain(message);
      }
      // Printed only in the code frame of a later console.error, never as a message.
      expect(output).not.toMatch(/console\.log\n\s+Silenced/);
      // Jest names the caller of each console message: the test, never the capture.
      expect(output).toMatch(
        /console\.log\n\s+Opening the cart\n\n\s+at .*tests\/output\.test\.js:11:/,
      );
      expect(output).not.toMatch(/capture-output|jest-reporter\/dist/);
    }
  });

  it('warns once without the setup file, and still reports every test', () => {
    expect(runs.noSetup.exitCode).toBe(0);
    const warnings = runs.noSetup.stderr.split('\n').filter((line) => line.includes('setup file'));
    expect(warnings).toEqual([
      expect.stringMatching(
        new RegExp(`^${SETUP_MISSING.replace(/[[\]().*+?]/g, '\\$&')} \\(first seen in tests/`),
      ),
    ]);
    const files = filesByTest(fakes[2] as FakeProbara);
    expect(Object.keys(files).sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(Object.values(files).flat(2)).toEqual([]);
  });

  it('does nothing from the setup file without the reporter', () => {
    expect(runs.noReporter.exitCode).toBe(0);
    expect(runs.noReporter.stderr).toContain('Opening the cart');
    expect(runs.noReporter.stdout + runs.noReporter.stderr).not.toContain('[probara]');
  });
});
