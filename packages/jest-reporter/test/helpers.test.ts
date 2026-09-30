/**
 * `probara.*` in the real `jest`, in each supported version, in workers and in band, against a fake
 * Probara: every helper, nested steps and their files, `test.each`, `jest.retryTimes`,
 * `test.concurrent`, a jsdom environment, an ES module test file, calls outside any test, and the
 * same project without the reporter, where every helper does nothing.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommitAttachmentsRequest, ReportRequest } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
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
const OUTSIDE =
  'only works while a test runs (in a test, or a beforeEach or afterEach hook) (first seen in tests/outside.test.js; repeats are logged at debug)';

type Entry = ReportRequest['results'][number];
type Step = NonNullable<Entry['steps']>[number];

function entriesOf(fake: FakeProbara): Entry[] {
  return fake.reports().flatMap((report) => report.results);
}

/** The entries of the test whose key ends with `test`, in the order they were sent. */
function entriesFor(fake: FakeProbara, test: string): Entry[] {
  return entriesOf(fake).filter((entry) => entry.automationKey?.endsWith(` > ${test}`) === true);
}

/** A step tree without durations, each error cut to its first line. */
function shapeOf(steps: readonly Step[] | undefined): unknown[] | undefined {
  return steps?.map(({ action, status, expected, data, error, steps: children }) => ({
    action,
    status,
    ...(expected === undefined ? {} : { expected }),
    ...(data === undefined ? {} : { data }),
    ...(error === undefined ? {} : { error: error.split('\n')[0] }),
    ...(children === undefined ? {} : { steps: shapeOf(children) }),
  }));
}

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

/** The `Tests:` line of Jest's summary. */
function testsLine(run: CommandRun): string | undefined {
  return /^Tests: .*$/m.exec(run.stderr)?.[0];
}

/** The channel directories left in the temporary directory of a run. */
async function leftovers(tmp: string): Promise<string[]> {
  return (await readdir(tmp)).filter((name) => name.startsWith('probara-jest-channel-'));
}

describe.each(JEST_VERSIONS)('probara.* in $name', (jest) => {
  describe.each([
    { mode: 'in workers', args: ['--maxWorkers=2'] },
    { mode: 'in band', args: ['--runInBand'] },
  ])('$mode', ({ args }) => {
    let fake: FakeProbara;
    let workspace: Workspace;
    let run: CommandRun;
    let tmp: string;

    beforeAll(async () => {
      fake = await startFakeProbara({ token: TOKEN });
      workspace = await createWorkspace(jest, 'helpers');
      tmp = join(workspace.dir, 'tmp');
      await mkdir(tmp);
      run = await workspace.jest(args, probaraEnv(fake.baseUrl, { TMPDIR: tmp }));
    }, TIMEOUT);

    afterAll(async () => {
      await fake.close();
      await workspace.remove();
    });

    it('keeps the verdicts of the tests, counts the ignored attempt, and removes its channel', async () => {
      expect(testsLine(run)).toBe('Tests:       1 failed, 11 passed, 12 total');
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toMatch(/\[probara\] Sending .*; 1 ignored with probara\.ignore\(\)/);
      expect(entriesFor(fake, 'checkout is left out with probara.ignore()')).toEqual([]);
      expect(run.stdout + run.stderr).not.toContain(TOKEN);
      expect(await leftovers(tmp)).toEqual([]);
    });

    it('sends the ids, title, suites, comment, parameters, tags and fields of a test and its hooks', () => {
      const entries = entriesFor(fake, 'checkout links cases and names the case it creates');
      expect(entries.map((entry) => entry.caseDisplayId)).toEqual(['SHOP-31', 'SHOP-32']);
      for (const entry of entries) {
        expect(entry).toMatchObject({
          status: 'passed',
          title: 'Pays with a saved card',
          suitePath: ['Payments', 'Cards'],
          notes: 'Paid with visa',
          parameters: { hook: 'beforeEach' },
          case: {
            description: 'Pays with a card on file',
            tags: ['smoke', 'from-afterEach'],
            fields: { severity: 'critical' },
          },
        });
      }
    });

    it('sends nested steps with their statuses, durations and errors, and the case steps', () => {
      const [entry] = entriesFor(
        fake,
        'checkout records nested steps, their files and their failures',
      );
      expect(entry?.status).toBe('failed');
      expect(entry?.parameters).toEqual({ hook: 'beforeEach' });
      expect(shapeOf(entry?.steps)).toEqual([
        {
          action: 'Open the cart',
          status: 'passed',
          expected: 'The cart lists 3 items',
          data: 'sku=42',
          steps: [{ action: 'Load the items', status: 'passed' }],
        },
        {
          action: 'Pay',
          status: 'passed',
          expected: 'The order is paid',
          steps: [{ action: 'Call the bank', status: 'passed' }],
        },
        {
          action: 'Refund',
          status: 'failed',
          // Jest 30's stack starts with the message, which core then sends once.
          error: expect.stringMatching(
            /^(Error: )?expect\(received\)\.toBe\(expected\)/,
          ) as unknown,
        },
      ]);
      expect(entry?.steps?.[1]?.durationMs).toBeGreaterThanOrEqual(15);
      expect(entry?.case?.steps).toEqual([
        { action: 'Open the cart', expected: 'The cart lists 3 items', data: 'sku=42' },
        { action: 'Pay', expected: 'The order is paid' },
        { action: 'Refund' },
      ]);
    });

    it('uploads the files attached by path (deleted afterwards) and by body, a step file to its step', () => {
      const staged = fake.stagedFiles();
      expect(staged.map((file) => `${file.name} ${file.type}`).sort()).toEqual([
        'bytes application/octet-stream',
        'dom.html text/html',
        'log.txt text/plain',
        'receipt.json application/json',
      ]);
      const content = Object.fromEntries(staged.map((file) => [file.name, file.sha256]));
      expect(content).toMatchObject({
        'receipt.json': sha256('{"paid":true}'),
        'log.txt': sha256('paid\n'),
        bytes: sha256(new Uint8Array([0, 1, 2, 255, 254])),
      });
      const committed = fake
        .requestsTo('commit')
        .flatMap((request) => (request.body as CommitAttachmentsRequest).attachments)
        .map((item) => [item.originalFilename, item.stepIndex ?? null]);
      // Pay is the third step of the result in pre-order.
      expect(committed).toContainEqual(['receipt.json', 2]);
      expect(committed).toContainEqual(['log.txt', null]);
    });

    it('gives every row of test.each and every attempt of jest.retryTimes its own metadata', () => {
      expect(entriesFor(fake, 'cards pays with visa').map((entry) => entry.parameters)).toEqual([
        { card: 'visa' },
      ]);
      expect(entriesFor(fake, 'cards pays with amex').map((entry) => entry.parameters)).toEqual([
        { card: 'amex' },
      ]);
      expect(
        entriesFor(fake, 'retries passes on the third attempt').map((entry) => [
          entry.status,
          entry.notes?.split('\n')[0],
          shapeOf(entry.steps),
        ]),
      ).toEqual([
        ['failed', 'attempt 1', [{ action: 'Try 1', status: 'passed' }]],
        ['failed', 'attempt 2', [{ action: 'Try 2', status: 'passed' }]],
        ['passed', 'attempt 3', [{ action: 'Try 3', status: 'passed' }]],
      ]);
    });

    it('never mixes the metadata of concurrent tests', () => {
      for (const who of ['slow', 'fast']) {
        expect(
          entriesFor(fake, `concurrent ${who}`).map((entry) => ({
            parameters: entry.parameters,
            notes: entry.notes,
            steps: shapeOf(entry.steps),
          })),
        ).toEqual([
          {
            parameters: { who },
            notes: who,
            steps: [{ action: `${who} step`, status: 'passed' }],
          },
        ]);
      }
    });

    it('ignores calls outside a test with one warning each, never giving them to a test', () => {
      const [entry] = entriesFor(fake, 'outside keeps nothing said outside it');
      expect(entry).toMatchObject({
        status: 'passed',
        title: 'outside keeps nothing said outside it',
      });
      expect(entry?.caseDisplayId).toBeUndefined();
      expect(entry?.case).toBeUndefined();
      const all = JSON.stringify(entriesOf(fake));
      for (const leaked of ['SHOP-99', 'From a describe body', 'from-beforeAll', 'From afterAll']) {
        expect(all).not.toContain(leaked);
      }
      for (const helper of ['id', 'title', 'tags', 'comment']) {
        expect(run.stderr.split(`[probara] probara.${helper}() ${OUTSIDE}`)).toHaveLength(2);
      }
      expect(run.stderr).toContain(
        '[probara] probara.tags() takes strings (first seen in tests/outside.test.js › outside keeps nothing said outside it;',
      );
    });

    it('works in a jsdom environment, from an ES module test file, and keeps the sandbox light', () => {
      expect(entriesFor(fake, 'works in a jsdom environment')).toMatchObject([
        {
          status: 'passed',
          parameters: { window: 'object' },
          steps: [{ action: 'Click Pay', status: 'passed' }],
        },
      ]);
      expect(entriesFor(fake, 'imports the helpers as an ES module')).toMatchObject([
        { status: 'passed', case: { tags: ['esm'] } },
      ]);
      expect(entriesFor(fake, 'loads only the helpers in the test sandbox')).toMatchObject([
        { status: 'passed', steps: [{ action: 'Sum', status: 'passed' }] },
      ]);
    });
  });

  it(
    'runs the same tests without the reporter, every helper doing nothing',
    async () => {
      const workspace = await createWorkspace(jest, 'helpers');
      try {
        const tmp = join(workspace.dir, 'tmp');
        await mkdir(tmp);
        const run = await workspace.jest(['--reporters=default'], { TMPDIR: tmp });
        expect(testsLine(run)).toBe('Tests:       1 failed, 11 passed, 12 total');
        expect(run.exitCode).toBe(1);
        expect(run.stdout + run.stderr).not.toContain('[probara]');
        expect(await readdir(tmp)).toEqual([]);
      } finally {
        await workspace.remove();
      }
    },
    TIMEOUT,
  );
});
