/**
 * Every example of the reporter's docs runs against the real reporter: each Jest config and test
 * file block in a real `jest` with the fake Probara, each output block equals what its commands
 * log, each sent block equals what Probara receives, and each files block lists the files it
 * receives (`examples.ts`). A project's run logs no `[probara]` line but its report's (`Sending`,
 * `Recorded`, a clean `Attached`) that an output block of the project does not show; a config
 * that names `projectId` runs without `PROBARA_PROJECT`. Sent and files blocks read a run in band
 * (`--runInBand`), so the entries come in the order Jest runs the files (larger first), not in the
 * order workers finish them; output blocks run their commands as written, `jest --watchAll` as a
 * session with a re-run (`runner.ts`).
 */
import { relative } from 'node:path';
import type { ReportRequest } from '@probara/core';
import { read, shown } from '@probara/test-support/docs/markdown';
import type { FakeProbara } from '@probara/test-support/fake-probara';
import { describe, expect, it } from 'vitest';
import { TOKEN, type CommandRun } from '../support/workspace.js';
import {
  commandOf,
  DEFAULT_PROJECT,
  normalize,
  pageOf,
  probaraLines,
  unshownLines,
  type DocProject,
  type OutputExample,
  type Page,
} from './examples.js';
import { PACKAGE_DIR, userDocs } from './markdown.js';
import { createDocsWorkspace, docsEnv, isWatchCommand } from './runner.js';
import { SCENARIOS, startDocsFake, type Scenario } from './scenarios.js';

const TIMEOUT = 120_000;
/** The pages that compare the reporter with other tools: only they may show their code. */
const MIGRATION_PAGE = /^docs\/(?:migrating-from-|coming-from-)/;
/** The tools whose code a not-run block may hold. */
const OTHER_TOOL = /Qase|Test IT|ReportPortal|Allure|TestRail|trcli|jest-junit/;

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

/**
 * The lines the output blocks of `project` show: a warning or an error its runs log must be one of
 * them.
 */
function shownBy(project: DocProject): string[] {
  const page = all.find((candidate) => candidate.projects.includes(project));
  return (page?.outputs ?? [])
    .filter((example) => example.project === project.id && example.stream === 'stderr')
    .flatMap((example) => example.commands.flatMap((command) => command.expected));
}

function scenarioOf(id: string): Scenario {
  const scenario = SCENARIOS[id];
  if (scenario === undefined) throw new Error(`unknown scenario "${id}"`);
  return scenario;
}

interface Execution {
  run: CommandRun;
  reports: ReportRequest[];
  /** `<name> <content type>` of every uploaded file. */
  staged: string[];
  /** What {@link normalize} replaces in its lines. */
  context: { baseUrl: string; dir: string };
}

/** Runs `jest --runInBand` in a copy of `project`, in `scenario`. */
async function execute(project: DocProject | undefined, id: string): Promise<Execution> {
  const scenario = scenarioOf(id);
  // Each resource is released by its own finally: one that fails to start or to stop never leaves
  // the other behind.
  const fake = await startDocsFake(scenario);
  try {
    const workspace = await createDocsWorkspace(project);
    try {
      scenario.setup?.(fake);
      const run = await workspace.run(
        { kind: 'jest', args: ['--runInBand'], assignments: [] },
        docsEnv(fake, scenario.env, project),
      );
      return {
        run,
        reports: fake.reports(),
        staged: fake.stagedFiles().map((file) => `${file.name} ${file.type}`),
        context: { baseUrl: fake.baseUrl, dir: workspace.dir },
      };
    } finally {
      await workspace.remove();
    }
  } finally {
    await fake.close();
  }
}

const executions = new Map<string, Promise<Execution>>();

/**
 * One run per project and scenario, shared by the tests that need it. A project is known by where
 * it starts: two pages may give their projects the same id.
 */
function executionOf(project: DocProject | undefined, scenario: string): Promise<Execution> {
  const key = `${project?.where ?? DEFAULT_PROJECT}|${scenario}`;
  let execution = executions.get(key);
  if (execution === undefined) {
    execution = execute(project, scenario);
    executions.set(key, execution);
  }
  return execution;
}

/**
 * The lines an output block compares: the `[probara]` lines of stderr, or the CLI's stdout with
 * `stream: stdout` (Jest's own output is its reporters', never compared).
 */
function shownLines(example: OutputExample, kind: string, run: CommandRun): string {
  return example.stream === 'stdout' && kind === 'probara'
    ? run.stdout.trimEnd()
    : probaraLines(run.stderr).join('\n');
}

/**
 * The pages with examples: each holds a project and a block that checks what it does (output, sent
 * or files). The others (the changelog, the CI guides, network, upgrade) show command lines, which
 * `command-lines.test.ts` runs.
 */
const EXAMPLE_PAGES = [
  'README.md',
  'docs/assign-failed.md',
  'docs/attachments.md',
  'docs/coming-from-other-tools.md',
  'docs/configuration.md',
  'docs/debugging.md',
  'docs/linking.md',
  'docs/links.md',
  'docs/metadata.md',
  'docs/migrating-from-junit.md',
  'docs/migrating-from-qase.md',
  'docs/projects.md',
  'docs/results-file.md',
  'docs/retries.md',
  'docs/run-selection.md',
  'docs/runs.md',
  'docs/statuses.md',
  'docs/steps.md',
  'docs/troubleshooting.md',
  'docs/watch.md',
];

describe('the examples of the docs', () => {
  it.each(EXAMPLE_PAGES)('are found on %s, which promises them', (name) => {
    const page = pages.get(name);

    expect(page, `${name} is no page of the docs`).toBeDefined();
    expect(page?.projects.length, name).toBeGreaterThan(0);
    expect(
      (page?.outputs.length ?? 0) + (page?.sent.length ?? 0) + (page?.files.length ?? 0),
      name,
    ).toBeGreaterThan(0);
  });

  it('use every scenario of scenarios.ts: one no block names is dead code', () => {
    const named = new Set([...outputs, ...sent, ...files].map((example) => example.scenario));

    expect(Object.keys(SCENARIOS).filter((id) => !named.has(id))).toEqual([]);
  });

  it.each([...pages].map(([name, page]) => [name, page] as const))(
    '%s has only examples the harness can run',
    (name, page) => {
      expect(page.problems).toEqual([]);
      // Only code of another tool is left out, and only where the reporter is compared with it.
      if (!MIGRATION_PAGE.test(name)) expect(page.notRun).toEqual([]);
      for (const { reason } of page.notRun) expect(reason).toMatch(OTHER_TOOL);
    },
  );

  it.concurrent.each(projects.map((project) => [project.id, project] as const))(
    '%s runs in jest and reports',
    async (_id, project) => {
      const { run, reports, context } = await executionOf(project, '');
      const output = `${run.stdout}\n${run.stderr}`;

      expect(run.exitCode, output).toBe(project.exit);
      expect(output).not.toContain(TOKEN);
      // A misspelled option still reports, with a warning: only an output block may show one.
      expect(unshownLines(run.stderr, shownBy(project), context), output).toEqual([]);
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
      const scenario = scenarioOf(example.scenario);
      const fake: FakeProbara = await startDocsFake(scenario);
      try {
        const workspace = await createDocsWorkspace(project);
        try {
          scenario.setup?.(fake);
          const env = docsEnv(fake, scenario.env, project);
          for (const { command, expected } of example.commands) {
            const parsed = await commandOf(command, env);
            expect(['jest', 'probara'], command).toContain(parsed.kind);
            const run = isWatchCommand(parsed)
              ? await workspace.watch(parsed, env, {
                  runs: scenario.watch?.runs ?? 2,
                  between: (ended) => scenario.watch?.between?.(fake, ended),
                })
              : await workspace.run(parsed, env);
            const context = { baseUrl: fake.baseUrl, dir: workspace.dir };
            expect(
              normalize(shownLines(example, parsed.kind, run), context),
              `$ ${command}\n${run.stderr}`,
            ).toBe(normalize(expected.join('\n').trimEnd(), context));
          }
        } finally {
          await workspace.remove();
        }
      } finally {
        await fake.close();
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
