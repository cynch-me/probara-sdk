/**
 * What the examples-run tests of the reporters share: the project a block runs in, one run per
 * project and scenario, and the lines an output block compares.
 */
import {
  DEFAULT_PROJECT,
  probaraLines,
  type DocProject,
  type OutputExample,
  type Page,
} from './examples.js';

/**
 * The project an output, sent or files block at `where` runs in: the one called `id` of its page,
 * or the docs project itself (`undefined`) for {@link DEFAULT_PROJECT}.
 */
export function projectOf(
  pages: readonly Page[],
  where: string,
  id: string,
): DocProject | undefined {
  if (id === DEFAULT_PROJECT) return undefined;
  const page = pages.find((candidate) =>
    [...candidate.outputs, ...candidate.sent, ...candidate.files].some(
      (example) => example.where === where,
    ),
  );
  return page?.projects.find((project) => project.id === id);
}

/**
 * `execute`, run once per project and scenario and shared by the tests that need it. A project is
 * known by where it starts: two pages may give their projects the same id.
 */
export function executionCache<E>(
  execute: (project: DocProject | undefined, scenario: string) => Promise<E>,
): (project: DocProject | undefined, scenario: string) => Promise<E> {
  const executions = new Map<string, Promise<E>>();
  return (project, scenario) => {
    const key = `${project?.where ?? DEFAULT_PROJECT}|${scenario}`;
    let execution = executions.get(key);
    if (execution === undefined) {
      execution = execute(project, scenario);
      executions.set(key, execution);
    }
    return execution;
  };
}

/**
 * The lines an output block compares for a command of `kind`: the `[probara]` lines of stderr, or
 * the CLI's stdout with `stream: stdout` (the test tool's own output is its reporters', never
 * compared).
 */
export function shownLines(
  example: OutputExample,
  kind: string,
  run: { stdout: string; stderr: string },
): string {
  return example.stream === 'stdout' && kind === 'probara'
    ? run.stdout.trimEnd()
    : probaraLines(run.stderr).join('\n');
}
