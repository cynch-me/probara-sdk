/**
 * Steps, step files, parameters and the created case in a real `playwright test`, through blob
 * reports and `merge-reports` and across shards too, against a fake Probara that refuses what the
 * API refuses.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommitAttachmentsRequest, ReportRequest } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkspace,
  playwrightAtLeast,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 180_000;
const CONFIG = 'playwright.steps.config.js';
const KEY = 'checkout.spec.js > checkout';
/** Playwright reports the files of each step, and `test.step.skip()`, since 1.50. */
const PER_STEP = playwrightAtLeast(1, 50);

type Entry = ReportRequest['results'][number];
type Step = NonNullable<Entry['steps']>[number];

/** A step tree without its durations, and each error cut to its first line. */
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

/** Every entry by the title of its test, with its parameters, step tree and case. */
function entriesOf(reports: readonly ReportRequest[]): Record<string, unknown> {
  return Object.fromEntries(
    reports
      .flatMap((report) => report.results)
      .map((entry) => [
        (entry.automationKey ?? '').replace(`${KEY} > `, '').replace(' [project=alpha]', ''),
        { parameters: entry.parameters, steps: shapeOf(entry.steps), case: entry.case },
      ]),
  );
}

/** The committed files of every result: name and step, in commit order. */
function commitsOf(fake: FakeProbara): [string, number | null | undefined][][] {
  return fake
    .requestsTo('commit')
    .map((request) => request.body as CommitAttachmentsRequest)
    .map((body) =>
      body.attachments
        .map(
          (item) =>
            [item.originalFilename ?? '', item.stepIndex] as [string, number | null | undefined],
        )
        // Playwright writes an error context for failed attempts since 1.51.
        .filter(([name]) => name !== 'error-context.md'),
    )
    .filter((items) => items.length > 0);
}

const LOG_IN = {
  action: 'Before Hooks',
  status: 'passed',
  steps: [
    {
      action: 'beforeEach hook',
      status: 'passed',
      steps: [
        { action: 'Log in', status: 'passed', expected: 'The dashboard shows', data: 'user=admin' },
      ],
    },
  ],
};
const LOG_IN_CASE_STEP = { action: 'Log in', expected: 'The dashboard shows', data: 'user=admin' };

const ENTRIES = {
  'reports its steps, their files and the case it creates': {
    parameters: { browser: 'chromium', retries: '0' },
    steps: [
      LOG_IN,
      {
        action: 'Open the cart',
        status: 'passed',
        expected: 'It lists 1 item',
        data: 'sku=42',
        steps: [{ action: 'Check the total', status: 'passed' }],
      },
      { action: 'Pay', status: 'passed' },
    ],
    case: {
      description: 'Pays with a saved card',
      tags: ['smoke', 'payments'],
      fields: { priority: 'high', Sevrity: 'critical' },
      steps: [
        LOG_IN_CASE_STEP,
        { action: 'Open the cart', expected: 'It lists 1 item', data: 'sku=42' },
        { action: 'Pay' },
      ],
    },
  },
  'fails in a step': {
    steps: [
      LOG_IN,
      {
        action: 'Submit',
        status: 'failed',
        error: expect.stringContaining('expect(received).toBe(expected)') as string,
      },
    ],
    case: { steps: [LOG_IN_CASE_STEP] },
  },
  'skips a step': {
    steps: [
      LOG_IN,
      ...(PER_STEP ? [{ action: 'Not yet', status: 'skipped' }] : []),
      { action: 'Done', status: 'passed' },
    ],
    case: { steps: [LOG_IN_CASE_STEP] },
  },
};

/**
 * The files of the first test: the result's own first, then those of its steps with the index of
 * their step (0 Before Hooks, 1 beforeEach hook, 2 Log in, 3 Open the cart, 4 Check the total,
 * 5 Pay). Before 1.50 Playwright does not say which step a file belongs to: all stay with the result.
 */
const FILES = PER_STEP
  ? [
      ['receipt.txt', undefined],
      ['cart.json', 4],
      ['pixel.png', 5],
    ]
  : [
      ['cart.json', undefined],
      ['pixel.png', undefined],
      ['receipt.txt', undefined],
    ];

describe('steps, step files and the created case in playwright test', () => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let run: CommandRun;

  beforeAll(async () => {
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace();
    run = await workspace.playwright(
      ['test', '-c', CONFIG, '--reporter=@probara/playwright-reporter,blob'],
      probaraEnv(fake.baseUrl),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('sends the step tree, the parameters and the case of every attempt', () => {
    expect(run.exitCode).toBe(1);
    expect(entriesOf(fake.reports())).toEqual(ENTRIES);
    expect(run.stdout + run.stderr).not.toContain(TOKEN);
  });

  it('commits the files of a step to that step', () => {
    expect(commitsOf(fake)).toEqual([FILES]);
  });

  it('logs the warnings of Probara once', () => {
    expect(run.stderr.match(/Probara warned: Unknown field "Sevrity" was skipped/g)).toHaveLength(
      1,
    );
    expect(fake.createdCases()).toHaveLength(3);
  });

  it(
    'sends the same out of the merged blob report',
    async () => {
      const mergeFake = await startFakeProbara({ token: TOKEN });
      try {
        expect(await readdir(join(workspace.dir, 'blob-report'))).toHaveLength(1);
        const merged = await workspace.playwright(
          [
            'merge-reports',
            '-c',
            CONFIG,
            '--reporter',
            '@probara/playwright-reporter',
            'blob-report',
          ],
          probaraEnv(mergeFake.baseUrl),
        );
        expect(merged.stderr).toMatch(/\[probara\] Recorded 3 results/);
        expect(entriesOf(mergeFake.reports())).toEqual(ENTRIES);
        expect(commitsOf(mergeFake)).toEqual([FILES]);
      } finally {
        await mergeFake.close();
      }
    },
    TIMEOUT,
  );

  it(
    'sends the same from shards that share one run',
    async () => {
      const shardFake = await startFakeProbara({ token: TOKEN });
      try {
        const created = await workspace.probara(['run', 'create'], probaraEnv(shardFake.baseUrl));
        const env = probaraEnv(shardFake.baseUrl, { PROBARA_RUN_ULID: created.stdout.trim() });
        for (const shard of ['1/2', '2/2']) {
          await workspace.playwright(
            ['test', '-c', CONFIG, `--shard=${shard}`, '--reporter=@probara/playwright-reporter'],
            { ...env, FIXTURE_OUTPUT_DIR: `test-results-steps-${shard.replace('/', '-')}` },
          );
        }
        expect(shardFake.reports()).toHaveLength(2);
        expect(entriesOf(shardFake.reports())).toEqual(ENTRIES);
        expect(commitsOf(shardFake)).toEqual([FILES]);
      } finally {
        await shardFake.close();
      }
    },
    TIMEOUT,
  );
});
