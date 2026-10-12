/**
 * The copies of `probara.attach()` in a run with the blob reporter and no `--shard` (R-V6 fix 1): merging the
 * blobs of several machines needs them, because the blob names them. The run here sends nothing (no token), and
 * its copies must still be there for `--merge-reports`. Real Vitest in each supported major, against a fake Probara.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildReporter } from './support/reporter-build.js';
import {
  createWorkspace,
  probaraEnv,
  TOKEN,
  VITEST_VERSIONS,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 240_000;
const RECEIPT = fileURLToPath(new URL('./fixtures/attachments/files/receipt.txt', import.meta.url));

describe.each(VITEST_VERSIONS)(
  '$name: the copies of a run with the blob reporter and no --shard',
  (vitest) => {
    let merged: FakeProbara;
    let workspace: Workspace;
    let mergeOutput: string;

    beforeAll(async () => {
      await buildReporter();
      merged = await startFakeProbara({ token: TOKEN });
      workspace = await createWorkspace(vitest, 'attachments');
      // One machine of several: its blob is merged elsewhere, so this run keeps the copies its blob names.
      await workspace.vitest(['run', '--config', 'blob.config.mts']);
      const merge = await workspace.vitest(['--merge-reports'], probaraEnv(merged.baseUrl));
      mergeOutput = merge.stdout + merge.stderr;
    }, TIMEOUT);

    afterAll(async () => {
      await merged.close();
      await workspace.remove();
    });

    it('sends the file of probara.attach() from the merged blob, with its content', () => {
      const receipt = merged.stagedFiles().filter((file) => file.name === 'receipt.txt');
      expect(receipt).toMatchObject([
        { sha256: createHash('sha256').update(readFileSync(RECEIPT)).digest('hex') },
      ]);
      expect(mergeOutput).not.toContain('Skipped an attachment');
    });
  },
);
