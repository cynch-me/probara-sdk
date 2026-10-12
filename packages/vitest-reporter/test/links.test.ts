/**
 * `probara.link()` and `probara.issue()` in real Vitest, in each supported major, against a fake Probara (V9, as the
 * Jest reporter): links reach Probara in call order, and issues become links built with `issueUrlTemplate` (the
 * reporter option, or `PROBARA_ISSUE_URL_TEMPLATE`), named by their id. Without a template, issues are dropped with one
 * warning, and the other links are kept.
 */
import type { ReportRequest } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildReporter } from './support/reporter-build.js';
import {
  createWorkspace,
  probaraEnv,
  TOKEN,
  VITEST_VERSIONS,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 240_000;
const TEMPLATE = 'https://jira.example.com/browse/%s';
const DROPPED =
  '[probara] Dropped the issues of probara.issue(): no issueUrlTemplate turns their ids into links';

/** The links of each sent entry, by the title of its test. */
function linksByTest(fake: FakeProbara): Record<string, unknown> {
  const entries = fake.reports().flatMap((report: ReportRequest) => report.results);
  const links: Record<string, unknown> = {};
  for (const entry of entries) {
    links[entry.automationKey?.split(' > ').at(-1) ?? '?'] = entry.links ?? [];
  }
  return links;
}

const WITH_TEMPLATE = {
  'checkout links the build and its issues': [
    { url: 'https://ci.example.com/build/12', name: 'Build' },
    { url: 'https://jira.example.com/browse/SHOP%207%2Fb', name: 'SHOP 7/b' },
    { url: 'https://example.com/spec' },
  ],
  'checkout fails and names its issue': [
    { url: 'https://jira.example.com/browse/SHOP-8', name: 'SHOP-8' },
  ],
};

describe.each(VITEST_VERSIONS)('links and issues in $name', (vitest) => {
  let workspace: Workspace;
  const fakes: FakeProbara[] = [];
  const runs: Record<'option' | 'variable' | 'none', CommandRun> = {} as never;

  async function fake(): Promise<FakeProbara> {
    const started = await startFakeProbara({ token: TOKEN });
    fakes.push(started);
    return started;
  }

  beforeAll(async () => {
    await buildReporter();
    workspace = await createWorkspace(vitest, 'links');
    runs.option = await workspace.vitest(
      ['run', '--config', 'template.config.mts'],
      probaraEnv((await fake()).baseUrl),
    );
    runs.variable = await workspace.vitest(
      ['run'],
      probaraEnv((await fake()).baseUrl, { PROBARA_ISSUE_URL_TEMPLATE: TEMPLATE }),
    );
    runs.none = await workspace.vitest(['run'], probaraEnv((await fake()).baseUrl));
  }, TIMEOUT);

  afterAll(async () => {
    await Promise.all(fakes.map((each) => each.close()));
    await workspace.remove();
  });

  it('sends the links in call order, and the issues as links built with the template option', () => {
    expect(runs.option.exitCode).toBe(1);
    expect(linksByTest(fakes[0] as FakeProbara)).toEqual(WITH_TEMPLATE);
    expect(runs.option.stdout + runs.option.stderr).not.toContain(TOKEN);
  });

  it('builds the issue links from PROBARA_ISSUE_URL_TEMPLATE when the option is not set', () => {
    expect(linksByTest(fakes[1] as FakeProbara)).toEqual(WITH_TEMPLATE);
  });

  it('drops the issues with one warning when no template is set, and keeps the other links', () => {
    expect(linksByTest(fakes[2] as FakeProbara)).toEqual({
      'checkout links the build and its issues': [
        { url: 'https://ci.example.com/build/12', name: 'Build' },
        { url: 'https://example.com/spec' },
      ],
      'checkout fails and names its issue': [],
    });
    // The warning once per run: core's session adds where its first line was seen.
    expect(runs.none.stderr.split('\n').filter((line) => line.includes('Dropped'))).toEqual([
      `${DROPPED} (first seen in the run; repeats are logged at debug)`,
    ]);
  });
});
