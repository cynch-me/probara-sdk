/**
 * The results file in a real `playwright test`: what a refused run could not send is written to
 * `PROBARA_RESULTS_FILE`, and `probara import results` sends it later like the reporter would have.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReportRequest } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkspace,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 180_000;
const CONFIG = 'playwright.helpers.config.js';
const RESULTS_FILE = 'probara-results.json';

/** What each entry says, without its timing and notes: key, case, status, title and suites. */
function entriesOf(reports: readonly ReportRequest[]) {
  return reports
    .flatMap((report) => report.results)
    .map(({ automationKey, caseDisplayId, status, title, suitePath }) => ({
      automationKey,
      caseDisplayId,
      status,
      title,
      suitePath,
    }));
}

/** The name, type and content of every staged file, sorted; error contexts differ by run. */
function filesOf(fake: FakeProbara): string[] {
  return fake
    .stagedFiles()
    .map(({ name, type, sha256 }) =>
      name === 'error-context.md' ? `${name} ${type}` : `${name} ${type} ${sha256}`,
    )
    .sort();
}

describe('the results file of a playwright run', () => {
  let workspace: Workspace;
  const fakes: FakeProbara[] = [];
  let refused: CommandRun;
  let imported: CommandRun;
  let direct: FakeProbara;
  let later: FakeProbara;

  beforeAll(async () => {
    workspace = await createWorkspace();
    const down = await startFakeProbara({ token: TOKEN });
    direct = await startFakeProbara({ token: TOKEN });
    later = await startFakeProbara({ token: TOKEN });
    fakes.push(down, direct, later);
    down.fail('report', { status: 403 });
    const reporter = ['test', '-c', CONFIG, '--reporter=@probara/playwright-reporter'];
    refused = await workspace.playwright(reporter, {
      ...probaraEnv(down.baseUrl, { PROBARA_RESULTS_FILE: RESULTS_FILE }),
      FIXTURE_OUTPUT_DIR: 'test-results-refused',
    });
    await workspace.playwright(reporter, {
      ...probaraEnv(direct.baseUrl),
      FIXTURE_OUTPUT_DIR: 'test-results-direct',
    });
    imported = await workspace.probara(
      ['import', 'results', RESULTS_FILE],
      probaraEnv(later.baseUrl),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await Promise.all(fakes.map((fake) => fake.close()));
    await workspace.remove();
  });

  it('writes every attempt of a refused run to the file, and says how to send it', async () => {
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain(
      `[probara] Wrote the 7 results that were not sent to ${join(workspace.dir, RESULTS_FILE)}`,
    );
    const file = JSON.parse(await readFile(join(workspace.dir, RESULTS_FILE), 'utf8')) as {
      version: number;
      project: string;
      results: unknown[];
    };
    expect(file).toMatchObject({ version: 1, project: 'PRB' });
    expect(file.results).toHaveLength(7);
    expect(JSON.stringify(file)).not.toContain(TOKEN);
  });

  it('sends the file later with the keys, cases and files the reporter sends', () => {
    expect(imported.exitCode).toBe(0);
    expect(entriesOf(later.reports())).toEqual(entriesOf(direct.reports()));
    expect(filesOf(later)).toEqual(filesOf(direct));
    expect(later.runs().map((run) => run.state)).toEqual(['closed']);
    expect(imported.stdout + imported.stderr).not.toContain(TOKEN);
  });
});
