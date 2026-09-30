/**
 * Every example of the reporter's docs runs against the real reporter: each `playwright.config` and
 * test file block in a real `playwright test` with the fake Probara, each output block equals what
 * its commands log, and each sent block equals what Probara receives (`examples.ts`).
 */
import { relative } from 'node:path';
import type { ReportRequest } from '@probara/core';
import { read, shown } from '@probara/test-support/docs/markdown';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { describe, expect, it } from 'vitest';
import { TOKEN, type CommandRun } from '../support/workspace.js';
import {
  commandOf,
  DEFAULT_PROJECT,
  normalize,
  pageOf,
  probaraLines,
  type DocProject,
  type OutputExample,
  type Page,
} from './examples.js';
import { PACKAGE_DIR, userDocs } from './markdown.js';
import { writeBlobReports } from './jobs.js';
import { createDocsWorkspace, docsEnv } from './runner.js';
import { SCENARIOS } from './scenarios.js';

const TIMEOUT = 120_000;
/** A project with this file is merged from blob reports instead of run. */
const MERGE_CONFIG = 'merge.config.ts';

const pages = new Map<string, Page>(
  userDocs().map((file) => [relative(PACKAGE_DIR, file), pageOf(shown(file), read(file))]),
);
const all = [...pages.values()];
const projects = all.flatMap((page) => page.projects);
const outputs = all.flatMap((page) => page.outputs);
const sent = all.flatMap((page) => page.sent);
const files = all.flatMap((page) => page.files);

/** The project an output or sent block runs in: one of its page, or the docs project itself. */
function projectOf(where: string, id: string): DocProject | undefined {
  if (id === DEFAULT_PROJECT) return undefined;
  const page = all.find((candidate) =>
    [...candidate.outputs, ...candidate.sent, ...candidate.files].some(
      (example) => example.where === where,
    ),
  );
  return page?.projects.find((project) => project.id === id);
}

interface Execution {
  run: CommandRun;
  reports: ReportRequest[];
  /** `<name> <content type>` of every uploaded file. */
  staged: string[];
}

function stagedOf(fake: FakeProbara): string[] {
  return fake.stagedFiles().map((file) => `${file.name} ${file.type}`);
}

/** Runs `playwright test` in a copy of `project`, in `scenario`. */
async function execute(project: DocProject | undefined, scenario: string): Promise<Execution> {
  const fake = await startFakeProbara({ token: TOKEN });
  const workspace = await createDocsWorkspace(project);
  try {
    const setup = SCENARIOS[scenario];
    if (setup === undefined) throw new Error(`unknown scenario "${scenario}"`);
    setup.setup?.(fake);
    const env = docsEnv(fake, setup.env);
    // A config for `merge-reports` runs there, over the blob reports of two shards.
    if (project?.files.has(MERGE_CONFIG) === true) {
      await writeBlobReports(workspace, 'all-blob-reports', env);
      const run = await workspace.run(
        {
          kind: 'playwright',
          args: ['merge-reports', '--config', MERGE_CONFIG, './all-blob-reports'],
          assignments: [],
        },
        env,
      );
      return { run, reports: fake.reports(), staged: stagedOf(fake) };
    }
    const run = await workspace.run({ kind: 'playwright', args: ['test'], assignments: [] }, env);
    return { run, reports: fake.reports(), staged: stagedOf(fake) };
  } finally {
    await fake.close();
    await workspace.remove();
  }
}

const executions = new Map<string, Promise<Execution>>();

/** One run per project and scenario, shared by the tests that need it. */
function executionOf(project: DocProject | undefined, scenario: string): Promise<Execution> {
  const key = `${project?.id ?? DEFAULT_PROJECT}|${scenario}`;
  let execution = executions.get(key);
  if (execution === undefined) {
    execution = execute(project, scenario);
    executions.set(key, execution);
  }
  return execution;
}

/**
 * The lines an output block compares: the `[probara]` lines of stderr, or the CLI's stdout with
 * `stream: stdout` (Playwright's own stdout is its terminal reporter's, never compared).
 */
function shownLines(example: OutputExample, kind: string, run: CommandRun): string {
  return example.stream === 'stdout' && kind === 'probara'
    ? run.stdout.trimEnd()
    : probaraLines(run.stderr).join('\n');
}

describe('the examples of the docs', () => {
  it('are found on the pages that promise them', () => {
    expect(projects.length).toBeGreaterThan(0);
  });

  it.each([...pages].map(([name, page]) => [name, page] as const))(
    '%s has only examples the harness can run',
    (name, page) => {
      expect(page.problems).toEqual([]);
      // Only code of another tool is left out, and only where Qase is compared.
      if (name !== 'docs/migrating-from-qase.md') expect(page.notRun).toEqual([]);
      for (const { reason } of page.notRun) expect(reason).toMatch(/Qase/);
    },
  );

  it.concurrent.each(projects.map((project) => [project.id, project] as const))(
    '%s runs in playwright test and reports',
    async (_id, project) => {
      const { run, reports } = await executionOf(project, '');
      const output = `${run.stdout}\n${run.stderr}`;

      expect(run.exitCode, output).toBe(project.exit);
      expect(output).not.toContain(TOKEN);
      if (project.reports) {
        expect(reports.length, output).toBeGreaterThan(0);
        expect(run.stderr, output).toMatch(/^\[probara\] Recorded /m);
      } else {
        expect(reports, output).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it.concurrent.each(outputs.map((example) => [example.where, example] as const))(
    '%s is the real output',
    async (where, example) => {
      const project = projectOf(where, example.project);
      const scenario = SCENARIOS[example.scenario];
      expect(scenario, `unknown scenario "${example.scenario}"`).toBeDefined();
      const fake: FakeProbara = await startFakeProbara({ token: TOKEN });
      const workspace = await createDocsWorkspace(project);
      try {
        scenario?.setup?.(fake);
        const env = docsEnv(fake, scenario?.env);
        for (const { command, expected } of example.commands) {
          const parsed = await commandOf(command, env);
          expect(['playwright', 'probara'], command).toContain(parsed.kind);
          const run = await workspace.run(parsed, env);
          const context = { baseUrl: fake.baseUrl, dir: workspace.dir };
          expect(normalize(shownLines(example, parsed.kind, run), context), `$ ${command}`).toBe(
            normalize(expected.join('\n').trimEnd(), context),
          );
        }
      } finally {
        await fake.close();
        await workspace.remove();
      }
    },
    TIMEOUT,
  );

  it.concurrent.each(sent.map((example) => [example.where, example] as const))(
    '%s is what Probara receives',
    async (where, example) => {
      const { run, reports } = await executionOf(
        projectOf(where, example.project),
        example.scenario,
      );
      const entries = JSON.parse(
        JSON.stringify(reports.flatMap((report) => report.results)),
      ) as unknown[];

      expect(entries, run.stderr).toMatchObject(example.entries);
    },
    TIMEOUT,
  );

  it.concurrent.each(files.map((example) => [example.where, example] as const))(
    '%s lists the files Probara receives',
    async (where, example) => {
      const { run, staged } = await executionOf(
        projectOf(where, example.project),
        example.scenario,
      );

      expect([...staged].sort(), run.stderr).toEqual([...example.files].sort());
    },
    TIMEOUT,
  );
});
