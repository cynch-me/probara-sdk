/**
 * The results file in the real `jest`: what a refused run could not send is written to
 * `PROBARA_RESULTS_FILE`, the files `probara.attach()` attached kept next to it (never in the
 * system's temporary directory, which the run cleans up and another CI job cannot see), and
 * `probara import results` sends it later like the reporter would have.
 */
import { access, mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkspace,
  JEST_VERSIONS,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 180_000;
const RESULTS_FILE = 'results/probara-results.json';
const TESTS = ['tests/helpers.test.js'];

/** The name, type and content of every staged file, sorted. */
function filesOf(fake: FakeProbara): string[] {
  return fake
    .stagedFiles()
    .map(({ name, type, sha256 }) => `${name} ${type} ${sha256}`)
    .sort();
}

describe.each(JEST_VERSIONS)('the results file of a $name run', (jest) => {
  let workspace: Workspace;
  const fakes: FakeProbara[] = [];
  let refused: CommandRun;
  let written: { results: { attachments?: { path: string }[] }[] };
  let tmp: string;
  let imported: CommandRun;
  let direct: FakeProbara;
  let later: FakeProbara;

  beforeAll(async () => {
    workspace = await createWorkspace(jest, 'helpers');
    tmp = join(workspace.dir, 'tmp');
    await mkdir(tmp);
    const down = await startFakeProbara({ token: TOKEN });
    direct = await startFakeProbara({ token: TOKEN });
    later = await startFakeProbara({ token: TOKEN });
    fakes.push(down, direct, later);
    down.fail('report', { status: 403 });
    refused = await workspace.jest(
      TESTS,
      probaraEnv(down.baseUrl, { PROBARA_RESULTS_FILE: RESULTS_FILE, TMPDIR: tmp }),
    );
    await workspace.jest(TESTS, probaraEnv(direct.baseUrl, { TMPDIR: tmp }));
    written = JSON.parse(
      await readFile(join(workspace.dir, RESULTS_FILE), 'utf8'),
    ) as typeof written;
    imported = await workspace.probara(
      ['import', 'results', RESULTS_FILE],
      probaraEnv(later.baseUrl),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await Promise.all(fakes.map((fake) => fake.close()));
    await workspace.remove();
  });

  it('writes the refused results, with copies of their files next to the file, and removes its channel', async () => {
    expect(refused.stderr).toContain(
      `[probara] Wrote the 3 results that were not sent to ${join(workspace.dir, RESULTS_FILE)}`,
    );
    const paths = JSON.stringify(written);
    const folder = join(workspace.dir, 'results', 'probara-results-attachments');
    expect(paths).toContain(folder);
    expect(paths).not.toContain(tmp);
    expect(await readdir(tmp)).toEqual([]);
    expect(JSON.stringify(written)).not.toContain(TOKEN);
  });

  it('sends the file later with the files the reporter sends, then deletes it and its copies', async () => {
    expect(imported.exitCode).toBe(0);
    expect(filesOf(later)).toEqual(filesOf(direct));
    expect(filesOf(later)).toHaveLength(3);
    await expect(
      access(join(workspace.dir, 'results', 'probara-results-attachments')),
    ).rejects.toThrow();
    expect(imported.stdout + imported.stderr).not.toContain(TOKEN);
  });
});
