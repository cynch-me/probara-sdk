/**
 * Several projects in a real `playwright test`: each case goes into a run of its project, whether
 * the reporter creates the runs or `probara run create --project` made them for a sharded job.
 */
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkspace, probaraEnv, TOKEN, type Workspace } from './support/workspace.js';

const TIMEOUT = 120_000;
const CONFIG = 'playwright.projects.config.js';
const KEY = 'multi.spec.js > multi';

/** The project of each report, with the case (or the key, without a case) of each entry. */
function reportsOf(fake: FakeProbara) {
  return fake.requestsTo('report').map((request) => {
    const { results } = request.body as {
      results: { caseDisplayId?: string; automationKey?: string }[];
    };
    return [request.projectId, results.map((entry) => entry.caseDisplayId ?? entry.automationKey)];
  });
}

describe('several projects in playwright test', () => {
  let workspace: Workspace;

  beforeAll(async () => {
    workspace = await createWorkspace();
  }, TIMEOUT);

  afterAll(async () => {
    await workspace.remove();
  });

  it(
    'sends each case to a run of its project, the rest to the configured one, and drops unlisted projects',
    async () => {
      const fake = await startFakeProbara({ token: TOKEN });
      try {
        const run = await workspace.playwright(
          ['test', '-c', CONFIG, '--reporter=@probara/playwright-reporter'],
          probaraEnv(fake.baseUrl, { PROBARA_PROJECTS: 'WEB,API' }),
        );

        expect(run.exitCode).toBe(0);
        expect(reportsOf(fake)).toEqual([
          ['PRB', ['PRB-40', `${KEY} > creates a case in the configured project`]],
          ['WEB', ['WEB-3']],
          ['API', ['API-2']],
        ]);
        // The id of a listed project leaves the key, like the configured project's.
        expect(fake.reports()[1]?.results[0]?.automationKey).toBe(`${KEY} > opens the home page`);
        expect(fake.runs().map((created) => [created.projectId, created.state])).toEqual([
          ['PRB', 'closed'],
          ['WEB', 'closed'],
          ['API', 'closed'],
        ]);
        expect(run.stderr).toMatch(
          /\[probara\] Did not send the results linked to cases of OPS: OPS is neither the project \(PRB\) nor one of projects/,
        );
        expect(run.stderr).toMatch(/\[probara\] Recorded 1 result .* in R-2 of WEB \(closed\)/);
        expect(run.stdout + run.stderr).not.toContain(TOKEN);
      } finally {
        await fake.close();
      }
    },
    TIMEOUT,
  );

  it(
    'reports into the runs `probara run create --project` made, given in PROBARA_RUN_ULIDS, and leaves them open',
    async () => {
      const fake = await startFakeProbara({ token: TOKEN });
      try {
        const env = probaraEnv(fake.baseUrl);
        const prb = (await workspace.probara(['run', 'create'], env)).stdout.trim();
        const web = (
          await workspace.probara(['run', 'create', '--project', 'WEB'], env)
        ).stdout.trim();
        const run = await workspace.playwright(
          ['test', '-c', CONFIG, '--reporter=@probara/playwright-reporter'],
          probaraEnv(fake.baseUrl, {
            PROBARA_PROJECTS: 'WEB,API',
            PROBARA_RUN_ULIDS: `PRB=${prb},WEB=${web}`,
          }),
        );

        expect(run.exitCode).toBe(0);
        const runs = fake.requestsTo('report').map((request) => {
          const body = request.body as { run: { ulid?: string } };
          return [request.projectId, body.run.ulid ?? 'new'];
        });
        expect(runs).toEqual([
          ['PRB', prb],
          ['WEB', web],
          ['API', 'new'],
        ]);
        expect(fake.runs().map((created) => [created.projectId, created.state])).toEqual([
          ['PRB', 'open'],
          ['WEB', 'open'],
          ['API', 'closed'],
        ]);
      } finally {
        await fake.close();
      }
    },
    TIMEOUT,
  );
});
