/**
 * `probara.*` in a real `playwright test`: in tests and hooks, per attempt, through blob reports
 * and `merge-reports` too, against a fake Probara.
 */
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import type { ReportRequest } from '@probara/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkspace,
  playwrightAtLeast,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 120_000;
const CONFIG = 'playwright.helpers.config.js';
const KEY = 'checkout.spec.js > checkout';

/** What each entry says, without its timing: key, case, status, title, suites and notes. */
function entriesOf(reports: readonly ReportRequest[]) {
  return reports
    .flatMap((report) => report.results)
    .map(({ automationKey, caseDisplayId, status, title, suitePath, notes }) => ({
      automationKey,
      caseDisplayId,
      status,
      title,
      suitePath,
      // The comment or the skip reason, then the first paragraph of the error, if any.
      notes: notes?.split('\n\n').slice(0, 2),
    }));
}

/** The staged files, but the error contexts Playwright writes for failed attempts (since 1.51). */
function filesOf(server: FakeProbara): string[] {
  return server
    .stagedFiles()
    .filter((file) => file.name !== 'error-context.md')
    .map((file) => `${file.name} ${file.type}`);
}

const ENTRIES = [
  {
    automationKey: `${KEY} > links cases and names the case it creates [project=alpha]`,
    caseDisplayId: 'PRB-31',
    status: 'passed',
    title: 'Pays with a saved card',
    suitePath: ['Payments', 'Cards'],
    notes: ['after attempt 0'],
  },
  {
    automationKey: `${KEY} > links cases and names the case it creates [project=alpha]`,
    caseDisplayId: 'PRB-32',
    status: 'passed',
    title: 'Pays with a saved card',
    suitePath: ['Payments', 'Cards'],
    notes: ['after attempt 0'],
  },
  {
    automationKey: `${KEY} > comments before the error of every attempt [project=alpha]`,
    caseDisplayId: undefined,
    status: 'failed',
    title: 'comments before the error of every attempt [project=alpha]',
    suitePath: ['checkout.spec.js', 'checkout'],
    notes: ['after attempt 0', expect.stringContaining('expect(received).toBe(expected)')],
  },
  {
    automationKey: `${KEY} > comments before the error of every attempt [project=alpha]`,
    caseDisplayId: undefined,
    status: 'failed',
    title: 'comments before the error of every attempt [project=alpha]',
    suitePath: ['checkout.spec.js', 'checkout'],
    notes: ['after attempt 1', expect.stringContaining('expect(received).toBe(expected)')],
  },
  {
    automationKey: `${KEY} > ignores its first attempt only [project=alpha]`,
    caseDisplayId: undefined,
    status: 'passed',
    title: 'ignores its first attempt only [project=alpha]',
    suitePath: ['checkout.spec.js', 'checkout'],
    notes: ['after attempt 1'],
  },
  {
    automationKey: `${KEY} > declares case steps and attaches files [project=alpha]`,
    caseDisplayId: undefined,
    status: 'passed',
    title: 'declares case steps and attaches files [project=alpha]',
    suitePath: ['checkout.spec.js', 'checkout'],
    notes: ['after attempt 0'],
  },
  {
    automationKey: `${KEY} > is skipped with a reason [project=alpha]`,
    caseDisplayId: undefined,
    status: 'skipped',
    title: 'is skipped with a reason [project=alpha]',
    suitePath: ['checkout.spec.js', 'checkout'],
    notes: ['after attempt 0', 'Skipped: Not on this plan'],
  },
];

describe('probara.* in playwright test', () => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let run: CommandRun;

  beforeAll(async () => {
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace();
    run = await workspace.playwright(
      ['test', '-c', CONFIG, '--reporter=@probara/playwright-reporter,blob'],
      probaraEnv(fake.baseUrl, { PROBARA_DEBUG: 'true' }),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('applies ids, title, suite, comment, ignore and skip reasons per attempt, from tests and hooks', () => {
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toMatch(
      /\[probara\] Sending 6 results of 5 tests \(3 passed, 2 failed, 1 skipped, 0 blocked\); 1 ignored with probara\.ignore\(\)/,
    );
    expect(entriesOf(fake.reports())).toEqual(ENTRIES);
    expect(run.stdout + run.stderr).not.toContain(TOKEN);
  });

  it('uploads the files of probara.attach() under their names, and never the metadata', () => {
    // Since Playwright 1.50 a file attached in a test.step goes to that step, after the result's.
    expect(filesOf(fake)).toEqual(
      playwrightAtLeast(1, 50)
        ? ['pixel.png image/png', 'bytes application/octet-stream', 'cart.json application/json']
        : ['cart.json application/json', 'pixel.png image/png', 'bytes application/octet-stream'],
    );
    expect(fake.stagedFiles().some((file) => file.type.includes('probara'))).toBe(false);
  });

  it('uploads the bytes of a Uint8Array body intact', () => {
    const bytes = fake.stagedFiles().find((file) => file.name === 'bytes');
    expect(bytes).toMatchObject({
      size: 5,
      sha256: createHash('sha256')
        .update(new Uint8Array([0, 1, 2, 255, 254]))
        .digest('hex'),
    });
  });

  it('sends parameters, tags, fields and case steps, from tests and hooks', () => {
    const details = fake
      .reports()
      .flatMap((report) => report.results)
      .map(({ automationKey, parameters, case: created }) => ({
        test: (automationKey ?? '').replace(`${KEY} > `, '').replace(' [project=alpha]', ''),
        parameters,
        case: created,
      }));
    expect(details).toContainEqual({
      test: 'links cases and names the case it creates',
      parameters: { hook: 'beforeEach' },
      case: { tags: ['from-hook'], fields: { severity: 'critical', priority: 'high' } },
    });
    expect(details).toContainEqual({
      test: 'declares case steps and attaches files',
      parameters: { hook: 'beforeEach' },
      case: {
        tags: ['from-hook'],
        steps: [{ action: 'Open the cart', expected: 'The cart lists 1 item', data: 'sku=42' }],
      },
    });
    // Every reported attempt ran the hook and carries its own (the one of two cases, twice).
    expect(details.filter((detail) => detail.parameters?.hook === 'beforeEach')).toHaveLength(7);
    expect(run.stderr).not.toContain('Not sent until');
  });

  it(
    'reads the same metadata out of merged blob reports',
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
        expect(merged.stderr).toMatch(/\[probara\] Recorded 7 results/);
        expect(entriesOf(mergeFake.reports())).toEqual(ENTRIES);
        expect(filesOf(mergeFake)).toEqual(filesOf(fake));
      } finally {
        await mergeFake.close();
      }
    },
    TIMEOUT,
  );
});
