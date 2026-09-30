/**
 * Every command line of the docs that runs `jest` or `probara` (bash, YAML and Groovy blocks,
 * `run:` and `script:` lines of CI files included) runs in a copy of the docs project, against the
 * fake Probara, and exits as documented: 0, or the code of a trailing `# exit <code>` (`jobs.ts`).
 * A Buildkite pipeline runs as `buildkite-agent pipeline upload` leaves it
 * (`@probara/test-support/docs/jobs`).
 */
import { relative } from 'node:path';
import { parseMarker } from '@probara/test-support/docs/examples';
import { fencedBlocks, read, shown } from '@probara/test-support/docs/markdown';
import { COMMAND_LANGUAGES } from '@probara/test-support/docs/shell';
import { describe, expect, it } from 'vitest';
import { TOKEN } from '../support/workspace.js';
import { mentionsTool } from './examples.js';
import { runJob } from './jobs.js';
import { PACKAGE_DIR, userDocs } from './markdown.js';
import { createDocsWorkspace, DOCS_TEST_TIMEOUT_MS } from './runner.js';
import { startDocsFake } from './scenarios.js';

/** A job's commands share one workspace's budget, so a job gets the time of one example. */
const TIMEOUT = DOCS_TEST_TIMEOUT_MS;

const blocks = userDocs().flatMap((file) =>
  fencedBlocks(read(file))
    .filter((block) => COMMAND_LANGUAGES.has(block.lang))
    // A block of another tool, on the pages that compare the reporter with it (`examples-run`).
    .filter((block) => parseMarker(block.marker)?.name !== 'not-run')
    .filter((block) => block.content.split('\n').some(mentionsTool))
    .map((block) => ({ file, block })),
);

describe('command lines of the docs', () => {
  it('cover the pages that show commands, every CI guide and sharding', () => {
    const files = new Set(blocks.map(({ file }) => relative(PACKAGE_DIR, file)));
    for (const page of [
      'README.md',
      'docs/configuration.md',
      'docs/ci/github-actions.md',
      'docs/ci/gitlab.md',
      'docs/ci/jenkins.md',
      'docs/ci/azure-pipelines.md',
      'docs/ci/circleci.md',
      'docs/ci/bitbucket.md',
      'docs/ci/buildkite.md',
      'docs/ci/sharding.md',
    ]) {
      expect(files).toContain(page);
    }
  });

  it.concurrent.each(
    blocks.map(({ file, block }) => [`${shown(file)}:${block.line}`, block] as const),
  )(
    '%s runs as documented',
    async (_where, block) => {
      // Each resource is released by its own finally: one that fails to start or to stop never
      // leaves the other behind.
      const fake = await startDocsFake();
      try {
        const workspace = await createDocsWorkspace();
        try {
          const invocations = await runJob(block, { workspace, fake });

          expect(invocations.length).toBeGreaterThan(0);
          for (const invocation of invocations) {
            expect(invocation.output).not.toContain(TOKEN);
            expect(
              { line: invocation.line, command: invocation.text, exitCode: invocation.exitCode },
              invocation.output,
            ).toEqual({
              line: invocation.line,
              command: invocation.text,
              exitCode: invocation.expected,
            });
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
});
