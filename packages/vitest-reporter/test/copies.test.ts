/**
 * Which runs keep the copies of `probara.attach()` (V-D73, V7 review fix 2), in each supported major, against a fake
 * Probara: a run whose reporters Vitest ships deletes its copies once sent; a run with a reporter Probara cannot
 * recognize (an instance here) keeps them, because that reporter may write a blob, and the merge that reads the blob
 * needs the copies it names.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

const TIMEOUT = 180_000;
const RECEIPT = fileURLToPath(new URL('./fixtures/attachments/files/receipt.txt', import.meta.url));
const RECEIPT_SHA256 = createHash('sha256').update(readFileSync(RECEIPT)).digest('hex');

describe.each(VITEST_VERSIONS)('$name: the copies of a run, by its reporters', (vitest) => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let afterShipped: string[];
  let afterInstance: string[];

  /** The SHA-256 of each file under the probara copies folder of the attachments folder: copies are named by UUID. */
  const copiesIn = (): string[] => {
    const folder = join(workspace.dir, 'attachments', 'probara');
    try {
      return readdirSync(folder, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) =>
          createHash('sha256')
            .update(readFileSync(join(entry.parentPath, entry.name)))
            .digest('hex'),
        );
    } catch {
      return [];
    }
  };

  beforeAll(async () => {
    await buildReporter();
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest, 'attachments');
    await workspace.vitest(['run'], probaraEnv(fake.baseUrl));
    afterShipped = copiesIn();
    await workspace.vitest(['run', '--config', 'instance.config.mts'], probaraEnv(fake.baseUrl));
    afterInstance = copiesIn();
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('deletes the copies of a run whose reporters Vitest ships, once they are sent', () => {
    expect(fake.runs()).toHaveLength(2);
    expect(afterShipped).toEqual([]);
  });

  it('keeps the copies of a run with a reporter instance it cannot recognize, for a merge that reads its blob', () => {
    expect(afterInstance).toContain(RECEIPT_SHA256);
  });
});
