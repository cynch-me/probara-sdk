/**
 * Every command line of the docs that runs `jest` or `probara` (bash, YAML and Groovy blocks,
 * `run:` and `script:` lines of CI files included) runs in a copy of the docs project, against the
 * fake Probara, and exits as documented: 0, or the code of a trailing `# exit <code>` (`jobs.ts`).
 * A Buildkite pipeline runs as `buildkite-agent pipeline upload` leaves it.
 */
import { relative } from 'node:path';
import { parseMarker } from '@probara/test-support/docs/examples';
import { fencedBlocks, read, shown, type FencedBlock } from '@probara/test-support/docs/markdown';
import { COMMAND_LANGUAGES } from '@probara/test-support/docs/shell';
import { startFakeProbara } from '@probara/test-support/fake-probara';
import { describe, expect, it } from 'vitest';
import { TOKEN } from '../support/workspace.js';
import { mentionsTool } from './examples.js';
import { runJob } from './jobs.js';
import { PACKAGE_DIR, userDocs } from './markdown.js';
import { createDocsWorkspace } from './runner.js';

const TIMEOUT = 180_000;

/**
 * A Buildkite pipeline (YAML with top-level `steps:` that run `command:` or `commands:`; Azure's
 * top-level steps run `script:`, CircleCI's `command:` sits under a job's steps) as
 * `buildkite-agent pipeline upload` leaves it for the job's shell: each `$$` is one `$`. The upload
 * also fills in `$NAME`, blank when it does not know it; this leaves those to the job's variables,
 * so it cannot see one left unescaped. Another block is returned as it is.
 */
function uploadedByBuildkite(block: FencedBlock): FencedBlock {
  const lines = block.content.split('\n');
  const isPipeline =
    (block.lang === 'yaml' || block.lang === 'yml') &&
    lines.some((line) => /^steps:\s*$/.test(line)) &&
    lines.some((line) => /^\s*(?:-\s+)?commands?:/.test(line));
  return isPipeline ? { ...block, content: block.content.replace(/\$\$/g, '$') } : block;
}

const blocks = userDocs().flatMap((file) =>
  fencedBlocks(read(file))
    .filter((block) => COMMAND_LANGUAGES.has(block.lang))
    // A block of another tool, on the pages that compare the reporter with it (`examples-run`).
    .filter((block) => parseMarker(block.marker)?.name !== 'not-run')
    .filter((block) => block.content.split('\n').some(mentionsTool))
    .map((block) => ({ file, block })),
);

describe('a Buildkite pipeline, once uploaded', () => {
  const pipeline = [
    'env:',
    '  PROBARA_PROJECT: SHOP',
    'steps:',
    '  - command: npx jest --shard=$((BUILDKITE_PARALLEL_JOB + 1))/$$BUILDKITE_PARALLEL_JOB_COUNT',
  ].join('\n');

  it('leaves each $$ as one $ for the job shell, and $(...) and $((...)) as they are', () => {
    expect(uploadedByBuildkite({ lang: 'yaml', line: 1, content: pipeline }).content).toBe(
      pipeline.replace('$$BUILDKITE', '$BUILDKITE'),
    );
    const commands = 'steps:\n  - commands:\n      - meta-data set run "$$ULID" $(date)';
    expect(uploadedByBuildkite({ lang: 'yml', line: 1, content: commands }).content).toBe(
      'steps:\n  - commands:\n      - meta-data set run "$ULID" $(date)',
    );
  });

  it('leaves other CI files and shell blocks as they are', () => {
    for (const block of [
      // Azure Pipelines: top-level steps that run a script.
      { lang: 'yaml', line: 1, content: 'steps:\n  - script: echo $$' },
      // CircleCI: a command under a job's steps.
      {
        lang: 'yaml',
        line: 1,
        content: 'jobs:\n  t:\n    steps:\n      - run:\n          command: echo $$',
      },
      { lang: 'bash', line: 1, content: pipeline },
    ]) {
      expect(uploadedByBuildkite(block)).toEqual(block);
    }
  });
});

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
      const fake = await startFakeProbara({ token: TOKEN });
      try {
        const workspace = await createDocsWorkspace();
        try {
          const invocations = await runJob(uploadedByBuildkite(block), { workspace, fake });

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
