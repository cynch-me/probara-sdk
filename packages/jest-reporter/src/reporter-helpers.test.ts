/**
 * The reporter and the `probara.*` helpers of the test processes: the channel it hands them, and
 * what their calls change in the results it sends, with Jest's events in the orders workers give.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { CHANNEL_VARIABLE } from './channel.js';
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
  it('keeps the attached files a results file points at', async () => {
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
      expect([...readFileSync(attached?.path ?? '')]).toEqual([137, 80, 78, 71]);
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
