import { describe, expect, it } from 'vitest';
import type { Command } from './examples.js';
import { runJobWith, uploadedByBuildkite } from './jobs.js';
import type { FencedBlock } from './markdown.js';
import { parseLine, splitAssignments } from './shell.js';
import type { FakeProbara } from '../fake-probara.js';

const PIPELINE = [
  'env:',
  '  PROBARA_PROJECT: SHOP',
  'steps:',
  '  - command: npx jest --shard=$((BUILDKITE_PARALLEL_JOB + 1))/$$BUILDKITE_PARALLEL_JOB_COUNT',
].join('\n');

describe('a Buildkite pipeline, once uploaded', () => {
  it('leaves each $$ as one $ for the job shell, and $(...) and $((...)) as they are', () => {
    expect(uploadedByBuildkite({ lang: 'yaml', line: 1, content: PIPELINE }).content).toBe(
      PIPELINE.replace('$$BUILDKITE', '$BUILDKITE'),
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
      { lang: 'bash', line: 1, content: PIPELINE },
    ]) {
      expect(uploadedByBuildkite(block)).toEqual(block);
    }
  });
});

describe('runJobWith', () => {
  it('runs a Buildkite pipeline as its upload leaves it', async () => {
    const ran: string[][] = [];
    const block: FencedBlock = { lang: 'yaml', line: 1, content: PIPELINE };
    const invocations = await runJobWith<Command>(block, {
      dir: '/nowhere',
      fake: {} as FakeProbara,
      env: {},
      commandOf: async (line, env) => {
        const { assignments, command } = splitAssignments(
          (await parseLine(line, env, () => Promise.resolve(''))).words,
        );
        return {
          kind: command[1] === 'jest' ? 'jest' : 'other',
          args: command.slice(2),
          assignments,
        };
      },
      mentionsTool: (line) => line.includes('jest'),
      runs: (command) => command.kind === 'jest',
      writeResultsFile: () => Promise.resolve(),
      run: (command) => {
        ran.push(command.args);
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
      },
      valuedImportFlags: new Set(),
    });

    expect(ran).toEqual([['--shard=1/2']]);
    expect(invocations).toHaveLength(1);
  });
});
