/**
 * `probara.link()` and `probara.issue()` in the real `jest`, in each supported version, against a
 * fake Probara: links reach Probara in call order, and issues as links built with
 * `issueUrlTemplate` (the reporter option, or `PROBARA_ISSUE_URL_TEMPLATE`), named by their id;
 * without a template, issues are dropped with one warning.
 */
import type { ReportRequest } from '@probara/core';
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
const DROPPED =
  '[probara] Dropped the issues of probara.issue(): no issueUrlTemplate turns their ids into links';

/** The links of each sent entry, by the title of its test. */
function linksByTest(fake: FakeProbara): Record<string, unknown> {
  const entries = fake.reports().flatMap((report: ReportRequest) => report.results);
  const links: Record<string, unknown> = {};
  for (const entry of entries)
    links[entry.automationKey?.split(' > ').at(-1) ?? '?'] = entry.links ?? [];
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

describe.each(JEST_VERSIONS)('links and issues in $name', (jest) => {
  let workspace: Workspace;
  const fakes: FakeProbara[] = [];
  const runs: Record<'option' | 'variable' | 'none', CommandRun> = {} as never;

  async function fake(): Promise<FakeProbara> {
    const started = await startFakeProbara({ token: TOKEN });
    fakes.push(started);
    return started;
  }

  beforeAll(async () => {
    workspace = await createWorkspace(jest, 'links');
    runs.option = await workspace.jest(
      ['--config', 'template.config.js'],
      probaraEnv((await fake()).baseUrl),
    );
    runs.variable = await workspace.jest(
      [],
      probaraEnv((await fake()).baseUrl, {
        PROBARA_ISSUE_URL_TEMPLATE: 'https://jira.example.com/browse/%s',
      }),
    );
    runs.none = await workspace.jest([], probaraEnv((await fake()).baseUrl));
  }, TIMEOUT);

  afterAll(async () => {
    await Promise.all(fakes.map((each) => each.close()));
    await workspace.remove();
  });

  it('sends links in call order, and issues as links of the issueUrlTemplate option', () => {
    expect(runs.option.exitCode).toBe(1);
    expect(linksByTest(fakes[0] as FakeProbara)).toEqual(WITH_TEMPLATE);
    expect(runs.option.stderr).not.toContain('Dropped the issues');
    expect(runs.option.stdout + runs.option.stderr).not.toContain(TOKEN);
  });

  it('reads the template from PROBARA_ISSUE_URL_TEMPLATE', () => {
    expect(linksByTest(fakes[1] as FakeProbara)).toEqual(WITH_TEMPLATE);
  });

  it('drops the issues without a template, with one warning, and keeps the links', () => {
    expect(linksByTest(fakes[2] as FakeProbara)).toEqual({
      'checkout links the build and its issues': [
        { url: 'https://ci.example.com/build/12', name: 'Build' },
        { url: 'https://example.com/spec' },
      ],
      'checkout fails and names its issue': [],
    });
    expect(runs.none.stderr.split('\n').filter((line) => line.includes('Dropped'))).toEqual([
      expect.stringContaining(DROPPED),
    ]);
  });
});
