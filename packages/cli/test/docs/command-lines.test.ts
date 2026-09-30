/**
 * Every command line of the docs that runs probara (bash, YAML and Groovy blocks, `run:` and
 * `script:` lines of CI files included) runs against the fake Probara and exits as documented:
 * 0, or the code of a trailing `# exit <code>` comment.
 */
import { rm } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { COMMAND_LANGUAGES, createWorkspace, runBlock } from './harness.js';
import { fencedBlocks, read, REPO_DIR, shown, userDocs } from './markdown.js';
import { mentionsProbara } from './shell.js';
import { join } from 'node:path';

const blocks = [join(REPO_DIR, 'README.md'), ...userDocs()].flatMap((file) =>
  fencedBlocks(read(file))
    .filter((block) => COMMAND_LANGUAGES.has(block.lang))
    .filter((block) => block.content.split('\n').some(mentionsProbara))
    .map((block) => ({ file, block })),
);

let workspace: string;
let fake: FakeProbara;

beforeAll(async () => {
  workspace = await createWorkspace();
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

beforeEach(async () => {
  fake = await startFakeProbara({ token: 'prb_test_T0KEN_must_never_leak_42' });
});

afterEach(async () => {
  await fake.close();
});

describe('command lines of the docs', () => {
  it('cover the README, every command, every CI provider and sharding', () => {
    const files = new Set(blocks.map(({ file }) => shown(file)));

    for (const page of [
      'packages/cli/README.md',
      'packages/cli/docs/commands.md',
      'packages/cli/docs/ci/github-actions.md',
      'packages/cli/docs/ci/gitlab.md',
      'packages/cli/docs/ci/jenkins.md',
      'packages/cli/docs/ci/azure-pipelines.md',
      'packages/cli/docs/ci/circleci.md',
      'packages/cli/docs/ci/bitbucket.md',
      'packages/cli/docs/ci/buildkite.md',
      'packages/cli/docs/ci/sharding.md',
    ]) {
      expect(files).toContain(page);
    }
  });

  it.each(blocks.map(({ file, block }) => [`${shown(file)}:${block.line}`, block] as const))(
    '%s runs as documented',
    async (_where, block) => {
      const invocations = await runBlock(block, { cwd: workspace, fake });

      expect(invocations.length).toBeGreaterThan(0);
      for (const invocation of invocations) {
        expect(
          { line: invocation.line, command: invocation.text, exitCode: invocation.exitCode },
          invocation.output,
        ).toEqual({
          line: invocation.line,
          command: invocation.text,
          exitCode: invocation.expected,
        });
      }
    },
  );
});
