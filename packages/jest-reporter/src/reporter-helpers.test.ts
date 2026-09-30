/**
 * The reporter and the `probara.*` helpers of the test processes: the channel it hands them, and
 * what their calls change in the results it sends, with Jest's events in the orders workers give.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Test } from '@jest/reporters';
import type { CommitAttachmentsRequest, Logger } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fakeCaseResult,
  fakeCaseStart,
  fakeFileResult,
  fakeTest,
  ROOT_DIR,
  type JestVersion,
} from '../test/support/jest-fakes.js';
import { appendLine, CHANNEL_VARIABLE, readSettings } from './channel.js';
import type { CurrentTest } from './current-test.js';
import type { ProbaraJestOptions } from './options.js';
import { createProbara, type Probara } from './probara.js';
import { ProbaraJestReporter } from './reporter.js';

const TOKEN = 'prb_test_T0KEN_must_never_leak_42';

function capturingLogger() {
  const lines: string[] = [];
  const logger: Logger = {
    debug: (message) => lines.push(`debug: ${message}`),
    info: (message) => lines.push(`info: ${message}`),
    warn: (message) => lines.push(`warn: ${message}`),
    error: (message) => lines.push(`error: ${message}`),
  };
  return { logger, lines };
}

/** The helpers of a test process, for the test `running()` names, on the reporter's channel. */
function testProcess(running: () => CurrentTest | undefined, testFile?: string): Probara {
  return createProbara({
    channel: () => process.env[CHANNEL_VARIABLE],
    currentTest: running,
    testFile: () => testFile,
  });
}

let outer: string | undefined;

beforeEach(() => {
  outer = process.env[CHANNEL_VARIABLE];
  Reflect.deleteProperty(process.env, CHANNEL_VARIABLE);
});

afterEach(() => {
  if (outer === undefined) Reflect.deleteProperty(process.env, CHANNEL_VARIABLE);
  else process.env[CHANNEL_VARIABLE] = outer;
});

describe.each([29, 30] as const)(
  'ProbaraJestReporter and probara.* on Jest %i',
  (version: JestVersion) => {
    let fake: FakeProbara;

    beforeEach(async () => {
      fake = await startFakeProbara({ token: TOKEN });
    });

    afterEach(async () => {
      await fake.close();
    });

    function start(options: ProbaraJestOptions = {}) {
      const log = capturingLogger();
      const reporter = new ProbaraJestReporter(
        { rootDir: ROOT_DIR },
        {
          env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'PRB', PROBARA_BASE_URL: fake.baseUrl },
          logger: log.logger,
          sleep: () => Promise.resolve(),
          rootDir: ROOT_DIR,
          ...options,
        },
      );
      reporter.onRunStart();
      return { reporter, log };
    }

    function results() {
      return fake.reports().flatMap((report) => report.results);
    }

    /** Runs one test of `src/links.test.js` whose body calls `body`; its sent entries. */
    async function linkedRun(options: ProbaraJestOptions, body: (probara: Probara) => void) {
      const { reporter, log } = start(options);
      const file = fakeTest('src/links.test.js');
      const titles = ['links', 'pays'];
      const probara = testProcess(() => ({ file: file.path, test: 'links pays', attempt: 1 }));
      reporter.onTestFileStart(file);
      reporter.onTestCaseStart(file, fakeCaseStart(titles, Date.parse('2026-09-30T10:00:01.000Z')));
      body(probara);
      reporter.onTestCaseResult(file, fakeCaseResult(version, { titles }));
      reporter.onTestFileResult(
        file,
        fakeFileResult(version, file, [fakeCaseResult(version, { titles })]),
      );
      await reporter.onRunComplete();
      return { entries: results(), lines: log.lines };
    }

    it('sends the links of an attempt, and its issues as links built with issueUrlTemplate', async () => {
      const { entries, lines } = await linkedRun(
        { issueUrlTemplate: 'https://jira.example.com/browse/%s' },
        (probara) => {
          probara
            .link('https://ci.example.com/build/12', 'Build')
            .issue('SHOP 7/b')
            .link('https://example.com/spec');
        },
      );
      expect(entries.map((entry) => entry.links)).toEqual([
        [
          { url: 'https://ci.example.com/build/12', name: 'Build' },
          { url: 'https://jira.example.com/browse/SHOP%207%2Fb', name: 'SHOP 7/b' },
          { url: 'https://example.com/spec' },
        ],
      ]);
      expect(lines.filter((line) => line.startsWith('warn:'))).toEqual([]);
    });

    it('drops the issues without issueUrlTemplate, with one warning, and keeps the links', async () => {
      const { entries, lines } = await linkedRun({}, (probara) => {
        probara.issue('SHOP-7').link('https://ci.example.com/build/12').issue('SHOP-8');
      });
      expect(entries.map((entry) => entry.links)).toEqual([
        [{ url: 'https://ci.example.com/build/12' }],
      ]);
      expect(lines.filter((line) => line.startsWith('warn:'))).toEqual([
        'warn: Dropped the issues of probara.issue(): no issueUrlTemplate turns their ids into links (first seen in "pays"; repeats are logged at debug)',
      ]);
    });

    it('hands the test processes a fresh private channel per run, and removes it after the run', async () => {
      process.env[CHANNEL_VARIABLE] = '/an/outer/run';
      const first = start();
      const dir = process.env[CHANNEL_VARIABLE] ?? '';
      expect(dir).not.toBe('/an/outer/run');
      expect(existsSync(join(dir, 'files'))).toBe(true);
      await first.reporter.onRunComplete();
      expect(existsSync(dir)).toBe(false);
      expect(process.env[CHANNEL_VARIABLE]).toBe('/an/outer/run');

      // A watch mode re-run: a new reporter, a new channel.
      const second = start();
      expect(process.env[CHANNEL_VARIABLE]).not.toBe(dir);
      await second.reporter.onRunComplete();
      expect(process.env[CHANNEL_VARIABLE]).toBe('/an/outer/run');
    });

    it('applies the metadata, steps and files of each attempt, even when the next test starts first', async () => {
      const { reporter } = start();
      const file = fakeTest('src/cart.test.js');
      let running: CurrentTest | undefined;
      const probara = testProcess(() => running);
      const pays = ['cart', 'PRB-32 pays'];
      const adds = ['cart', 'adds'];

      reporter.onTestFileStart(file);
      reporter.onTestCaseStart(file, fakeCaseStart(pays, Date.parse('2026-09-30T10:00:01.000Z')));
      running = { file: file.path, test: 'cart PRB-32 pays', attempt: 1 };
      probara
        .id('PRB-31')
        .title('Pays with a saved card')
        .suite(['Payments', 'Cards'])
        .comment('Paid with visa')
        .parameters({ card: 'visa' })
        .tags('smoke')
        .fields({ severity: 'critical', description: 'Pays with a card on file' });
      probara.step(
        'Open the cart',
        () => {
          void probara.attach({
            name: 'cart',
            body: '{"items":1}',
            contentType: 'application/json',
          });
          probara.step('Load the items');
        },
        { expected: 'The cart lists 1 item', data: 'sku=42' },
      );
      void probara.attach({ name: 'log', body: 'paid\n' });
      reporter.onTestCaseStart(file, fakeCaseStart(adds, Date.parse('2026-09-30T10:00:02.000Z')));
      running = { file: file.path, test: 'cart adds', attempt: 1 };
      probara.comment('Added one');
      reporter.onTestCaseResult(file, fakeCaseResult(version, { titles: adds }));
      reporter.onTestCaseResult(file, fakeCaseResult(version, { titles: pays }));
      reporter.onTestFileResult(
        file,
        fakeFileResult(version, file, [
          fakeCaseResult(version, { titles: pays }),
          fakeCaseResult(version, { titles: adds }),
        ]),
      );
      await reporter.onRunComplete();

      const paid = results().filter(
        (entry) => entry.automationKey === 'src/cart.test.js > cart pays',
      );
      expect(paid.map((entry) => entry.caseDisplayId)).toEqual(['PRB-31', 'PRB-32']);
      expect(paid[0]).toMatchObject({
        title: 'Pays with a saved card',
        suitePath: ['Payments', 'Cards'],
        notes: 'Paid with visa',
        parameters: { card: 'visa' },
        case: {
          description: 'Pays with a card on file',
          tags: ['smoke'],
          fields: { severity: 'critical' },
          steps: [{ action: 'Open the cart', expected: 'The cart lists 1 item', data: 'sku=42' }],
        },
        steps: [
          {
            action: 'Open the cart',
            status: 'passed',
            expected: 'The cart lists 1 item',
            data: 'sku=42',
            steps: [{ action: 'Load the items', status: 'passed' }],
          },
        ],
      });
      expect(typeof paid[0]?.steps?.[0]?.durationMs).toBe('number');
      const added = results().find(
        (entry) => entry.automationKey === 'src/cart.test.js > cart adds',
      );
      expect(added).toMatchObject({ notes: 'Added one', suitePath: ['src/cart.test.js'] });
      // Its own default title: nothing of the other test's.
      expect(added?.title).toBe('cart adds');

      expect(fake.stagedFiles().map((staged) => `${staged.name} ${staged.type}`)).toEqual(
        expect.arrayContaining(['log.txt text/plain', 'cart.json application/json']),
      );
      const committed = fake
        .requestsTo('commit')
        .flatMap((request) => (request.body as CommitAttachmentsRequest).attachments)
        .map((item) => [item.originalFilename, item.stepIndex ?? null]);
      expect(committed).toEqual(
        expect.arrayContaining([
          ['log.txt', null],
          ['cart.json', 0],
        ]),
      );
    });

    it('gives every attempt of a retried test its own metadata, and leaves out an ignored one', async () => {
      const { reporter, log } = start();
      const file = fakeTest();
      const flaky = ['login', 'is flaky'];
      let running: CurrentTest | undefined;
      const probara = testProcess(() => running);

      reporter.onTestFileStart(file);
      running = { file: file.path, test: 'login is flaky', attempt: 1 };
      probara.comment('attempt 1').ignore();
      reporter.onTestCaseResult(file, fakeCaseResult(version, { titles: flaky, status: 'failed' }));
      running = { ...running, attempt: 2 };
      probara.comment('attempt 2');
      reporter.onTestCaseResult(file, fakeCaseResult(version, { titles: flaky, invocations: 2 }));
      running = { ...running, attempt: 3 };
      probara.comment('attempt 3');
      reporter.onTestCaseResult(file, fakeCaseResult(version, { titles: flaky, invocations: 3 }));
      reporter.onTestFileResult(
        file,
        fakeFileResult(version, file, [fakeCaseResult(version, { titles: flaky, invocations: 3 })]),
      );
      await reporter.onRunComplete();

      expect(results().map((entry) => [entry.status, entry.notes])).toEqual([
        ['passed', 'attempt 2'],
        ['passed', 'attempt 3'],
      ]);
      expect(log.lines).toContain(
        'info: Sending 2 results of 1 test (2 passed, 0 failed, 0 skipped, 0 blocked); 1 ignored with probara.ignore()',
      );
    });

    it('logs the warnings of every test process once, and repeats at debug', async () => {
      const { reporter, log } = start();
      const file = fakeTest();
      for (const worker of [
        testProcess(() => undefined, file.path),
        testProcess(() => undefined, `${ROOT_DIR}/src/cart.test.js`),
      ]) {
        worker.title('in a describe body');
      }
      reporter.onTestFileResult(file, fakeFileResult(version, file, []));
      await reporter.onRunComplete();

      const outside =
        'probara.title() only works while a test runs (in a test, or a beforeEach or afterEach hook)';
      expect(log.lines.filter((line) => line.includes(outside))).toEqual([
        `warn: ${outside} (first seen in src/login.test.js; repeats are logged at debug)`,
        `debug: ${outside} (src/cart.test.js)`,
      ]);
    });

    it('names the test of a warning a test gave', async () => {
      const { reporter, log } = start();
      const file = fakeTest();
      const probara = testProcess(() => ({ file: file.path, test: 'login logs in', attempt: 1 }));
      (probara.tags as (...tags: unknown[]) => Probara)(42);
      reporter.onTestCaseResult(file, fakeCaseResult(version));
      reporter.onTestFileResult(file, fakeFileResult(version, file, [fakeCaseResult(version)]));
      await reporter.onRunComplete();

      expect(log.lines).toContain(
        'warn: probara.tags() takes strings (first seen in src/login.test.js › login logs in; repeats are logged at debug)',
      );
    });

    it('hands the setup file captureOutput through the channel', async () => {
      const on = start({ captureOutput: true });
      expect(readSettings(process.env[CHANNEL_VARIABLE] ?? '')).toEqual({ captureOutput: true });
      await on.reporter.onRunComplete();
      const off = start();
      expect(readSettings(process.env[CHANNEL_VARIABLE] ?? '')).toEqual({ captureOutput: false });
      await off.reporter.onRunComplete();
    });

    it('warns once when captureOutput is on and a test file ran without the setup file', async () => {
      const setupMissing =
        "captureOutput needs the setup file: add setupFilesAfterEnv: ['@probara/jest-reporter/setup'] to the Jest config";
      const { reporter, log } = start({ captureOutput: true });
      const dir = process.env[CHANNEL_VARIABLE] ?? '';
      const [login, cart, checkout] = ['login', 'cart', 'checkout'].map((name) =>
        fakeTest(`src/${name}.test.js`),
      ) as [Test, Test, Test];
      appendLine(dir, { type: 'setup', file: login.path });
      for (const file of [login, cart, checkout]) {
        reporter.onTestFileResult(file, fakeFileResult(version, file, [fakeCaseResult(version)]));
      }
      await reporter.onRunComplete();

      expect(log.lines.filter((line) => line.includes(setupMissing))).toEqual([
        `warn: ${setupMissing} (first seen in src/cart.test.js; repeats are logged at debug)`,
        `debug: ${setupMissing} (src/checkout.test.js)`,
      ]);

      // Off, nothing needs it.
      const off = start();
      off.reporter.onTestFileResult(cart, fakeFileResult(version, cart, [fakeCaseResult(version)]));
      await off.reporter.onRunComplete();
      expect(off.log.lines.filter((line) => line.includes('setup file'))).toEqual([]);
    });

    it('sends the attempts of tests that share a full name without any helper details, never mixing them', async () => {
      const { reporter, log } = start();
      const file = fakeTest('src/cart.test.js');
      let running: CurrentTest | undefined;
      const probara = testProcess(() => running);
      // A describe "cart pays" with a test "by card", and a describe "cart" with "pays by card":
      // Jest's full names are the same, so are the keys of their helper lines.
      const tests = [
        ['cart pays', 'by card'],
        ['cart', 'pays by card'],
      ];
      reporter.onTestFileStart(file);
      for (const [index, titles] of tests.entries()) {
        running = { file: file.path, test: 'cart pays by card', attempt: 1 };
        probara.comment(`test ${String(index + 1)}`).ignore();
        reporter.onTestCaseResult(file, fakeCaseResult(version, { titles }));
      }
      running = { file: file.path, test: 'cart adds', attempt: 1 };
      probara.comment('its own');
      const adds = fakeCaseResult(version, { titles: ['cart', 'adds'] });
      reporter.onTestCaseResult(file, adds);
      reporter.onTestFileResult(
        file,
        fakeFileResult(version, file, [
          ...tests.map((titles) => fakeCaseResult(version, { titles })),
          adds,
        ]),
      );
      await reporter.onRunComplete();

      expect(results().map((entry) => [entry.automationKey, entry.notes ?? null])).toEqual([
        ['src/cart.test.js > cart pays by card', null],
        ['src/cart.test.js > cart pays by card', null],
        ['src/cart.test.js > cart adds', 'its own'],
      ]);
      expect(log.lines.filter((line) => line.startsWith('warn:'))).toEqual([
        'warn: Several tests of one file have the same full name and attempt: what the probara.* helpers said about them is left out (first seen in src/cart.test.js › cart pays by card; repeats are logged at debug)',
      ]);
    });

    it('sends the attempts of a file two Jest projects run at once without any helper details', async () => {
      const { reporter, log } = start();
      const [node, dom] = [
        fakeTest('src/cart.test.js', 'node'),
        fakeTest('src/cart.test.js', 'dom'),
      ];
      const probara = testProcess(() => ({ file: node.path, test: 'cart adds', attempt: 1 }));
      const adds = fakeCaseResult(version, { titles: ['cart', 'adds'] });
      reporter.onTestFileStart(node);
      reporter.onTestFileStart(dom);
      probara.comment('in node');
      reporter.onTestCaseResult(node, adds);
      reporter.onTestFileResult(node, fakeFileResult(version, node, [adds]));
      probara.comment('in dom');
      reporter.onTestCaseResult(node, adds);
      reporter.onTestFileResult(dom, fakeFileResult(version, dom, [adds]));
      await reporter.onRunComplete();

      expect(results().map((entry) => entry.notes ?? null)).toEqual([null, null]);
      expect(log.lines.filter((line) => line.startsWith('warn:'))).toEqual([
        'warn: Several Jest projects ran this file at once: what the probara.* helpers said about its tests is left out (first seen in src/cart.test.js; repeats are logged at debug)',
      ]);
    });

    it('logs at debug what the helpers said about attempts Jest never reported, and unreadable lines', async () => {
      const { reporter, log } = start();
      const file = fakeTest();
      testProcess(() => ({ file: file.path, test: 'login logs in', attempt: 2 })).comment('lost');
      appendFileSync(join(process.env[CHANNEL_VARIABLE] ?? '', '1-0.jsonl'), '{"cut\n');
      const logsIn = fakeCaseResult(version);
      reporter.onTestCaseResult(file, logsIn);
      reporter.onTestFileResult(file, fakeFileResult(version, file, [logsIn]));
      await reporter.onRunComplete();

      expect(log.lines.filter((line) => line.includes('probara.*'))).toEqual([
        'debug: Left out what the probara.* helpers said about 1 attempt Jest did not report in src/login.test.js: "login logs in" attempt 2',
        'debug: Skipped 1 unreadable line of the probara.* channel',
      ]);
    });

    it('reports at the end, with their metadata, the attempts of a file Jest never finished', async () => {
      const { reporter } = start();
      const file = fakeTest();
      testProcess(() => ({ file: file.path, test: 'login logs in', attempt: 1 })).comment(
        'Crashed',
      );
      reporter.onTestCaseResult(file, fakeCaseResult(version));
      await reporter.onRunComplete();

      expect(results().map((entry) => entry.notes)).toEqual(['Crashed']);
    });
  },
);

describe('ProbaraJestReporter and probara.* while reporting is off', () => {
  it('keeps the attached files next to the results file, and removes its channel', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'probara-jest-results-'));
    try {
      const path = join(dir, 'results.json');
      const reporter = new ProbaraJestReporter(
        { rootDir: ROOT_DIR },
        {
          env: { PROBARA_ENABLED: 'false', PROBARA_PROJECT: 'PRB', PROBARA_RESULTS_FILE: path },
          logger: capturingLogger().logger,
          rootDir: ROOT_DIR,
        },
      );
      reporter.onRunStart();
      const channel = process.env[CHANNEL_VARIABLE] ?? '';
      const file = fakeTest();
      void testProcess(() => ({ file: file.path, test: 'login logs in', attempt: 1 })).attach({
        name: 'shot.png',
        body: new Uint8Array([137, 80, 78, 71]),
        contentType: 'image/png',
      });
      reporter.onTestCaseResult(file, fakeCaseResult(30));
      await reporter.onRunComplete();

      const written = JSON.parse(await readFile(path, 'utf8')) as {
        results: { attachments?: { path: string; fileName?: string }[] }[];
      };
      const attached = written.results[0]?.attachments?.[0];
      expect(attached?.fileName).toBe('shot.png');
      // Relative to the results file, so the file and its folder can move together.
      expect(dirname(attached?.path ?? '')).toBe('results-attachments');
      expect([...readFileSync(join(dir, attached?.path ?? ''))]).toEqual([137, 80, 78, 71]);
      expect(existsSync(channel)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('hands no channel to the tests when it reports nothing, so every helper does nothing', async () => {
    process.env[CHANNEL_VARIABLE] = '/an/outer/run';
    const reporter = new ProbaraJestReporter({ rootDir: ROOT_DIR }, { env: {} });
    reporter.onRunStart();
    expect(process.env[CHANNEL_VARIABLE]).toBeUndefined();
    await reporter.onRunComplete();
    expect(process.env[CHANNEL_VARIABLE]).toBe('/an/outer/run');
  });
});
