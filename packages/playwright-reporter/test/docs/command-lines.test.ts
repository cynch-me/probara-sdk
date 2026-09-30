/**
 * Every command line of the docs that runs `playwright` or `probara` (bash, YAML and Groovy blocks,
 * `run:` and `script:` lines of CI files included) runs in a copy of the docs project, against the
 * fake Probara, and exits as documented: 0, or the code of a trailing `# exit <code>` (`jobs.ts`).
 */
import { relative } from 'node:path';
import { fencedBlocks, read, shown } from '@probara/test-support/docs/markdown';
import { COMMAND_LANGUAGES } from '@probara/test-support/docs/shell';
import { startFakeProbara } from '@probara/test-support/fake-probara';
import { describe, expect, it } from 'vitest';
import { TOKEN } from '../support/workspace.js';
import { mentionsTool } from './examples.js';
import { runJob } from './jobs.js';
import { PACKAGE_DIR, userDocs } from './markdown.js';
import { createDocsWorkspace } from './runner.js';

const TIMEOUT = 180_000;

const blocks = userDocs().flatMap((file) =>
  fencedBlocks(read(file))
    .filter((block) => COMMAND_LANGUAGES.has(block.lang))
    .filter((block) => block.content.split('\n').some(mentionsTool))
    .map((block) => ({ file, block })),
);

describe('command lines of the docs', () => {
  it('cover every CI guide and sharding', () => {
    const files = new Set(blocks.map(({ file }) => relative(PACKAGE_DIR, file)));
    for (const page of [
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
      const fake = await startFakeProbara({ token: TOKEN });
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
        await fake.close();
        await workspace.remove();
      }
    },
    TIMEOUT,
  );
});
