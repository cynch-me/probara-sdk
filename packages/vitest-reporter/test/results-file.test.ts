/**
 * The results file in real Vitest, in each supported major (V9, as the Jest reporter): what a refused run could not send
 * is written to `PROBARA_RESULTS_FILE` as core's v1 file, the files `probara.attach()` attached are kept next to it in
 * `<name>-attachments/`, a later run never overwrites it (it takes the next free `-N` name), and `probara import results`
 * sends it later with the entries and files a direct run sends.
 */
import { readFile, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildReporter } from './support/reporter-build.js';
import {
  createWorkspace,
  probaraEnv,
  TOKEN,
  VITEST_VERSIONS,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 240_000;
const RESULTS_FILE = 'results/vitest-results.json';
/** The first free sibling of the file: core numbers a sibling from 2 (`probara-results-2.json`, as the Jest docs say). */
const NEXT_FILE = 'results/vitest-results-2.json';

/** The name, type and content of every staged file, sorted. */
function filesOf(fake: FakeProbara): string[] {
  return fake
    .stagedFiles()
    .map(({ name, type, sha256 }) => `${name} ${type} ${sha256}`)
    .sort();
}

/** The automation key and status of every result the fake received, sorted. */
function entriesOf(fake: FakeProbara): string[] {
  return fake
    .reports()
    .flatMap((report) => report.results)
    .map((entry) => `${entry.automationKey ?? ''} ${entry.status}`)
    .sort();
}

describe.each(VITEST_VERSIONS)('the results file of a $name run', (vitest) => {
  let workspace: Workspace;
  const fakes: FakeProbara[] = [];
  let refused: CommandRun;
  let again: CommandRun;
  let imported: CommandRun;
  let written: string;
  let kept: string;
  let direct: FakeProbara;
  let later: FakeProbara;

  beforeAll(async () => {
    await buildReporter();
    workspace = await createWorkspace(vitest, 'attachments');
    const down = await startFakeProbara({ token: TOKEN });
    direct = await startFakeProbara({ token: TOKEN });
    later = await startFakeProbara({ token: TOKEN });
    fakes.push(down, direct, later);
    down.fail('report', { status: 403 });
    refused = await workspace.vitest(
      ['run'],
      probaraEnv(down.baseUrl, { PROBARA_RESULTS_FILE: RESULTS_FILE }),
    );
    written = await readFile(join(workspace.dir, RESULTS_FILE), 'utf8');
    // A second run with the same file name: it writes the next free sibling, and leaves the first file as it is.
    again = await workspace.vitest(
      ['run'],
      probaraEnv(down.baseUrl, { PROBARA_RESULTS_FILE: RESULTS_FILE }),
    );
    kept = await readFile(join(workspace.dir, RESULTS_FILE), 'utf8');
    await workspace.vitest(['run'], probaraEnv(direct.baseUrl));
    imported = await workspace.probara(
      ['import', 'results', RESULTS_FILE],
      probaraEnv(later.baseUrl),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await Promise.all(fakes.map((fake) => fake.close()));
    await workspace.remove();
  });

  it('writes the refused results as a v1 file, with copies of their files next to it', () => {
    const file = JSON.parse(written) as {
      version: number;
      results: { attachments?: { path: string }[] }[];
    };
    expect(file.version).toBe(1);
    expect(refused.stderr).toContain(
      `[probara] Wrote the ${String(file.results.length)} results that were not sent to ${join(workspace.dir, RESULTS_FILE)}`,
    );
    // The file is pretty-printed: each attachment names its stored file by a `path`.
    const paths = [...written.matchAll(/"path": "([^"]*)"/g)].map((match) => match[1] ?? '');
    expect(paths.length).toBeGreaterThan(0);
    // The copies of probara.attach() sit next to the file, named relative to it, so the two can move together.
    const copies = paths.filter((path) => path.startsWith('vitest-results-attachments/'));
    expect(copies.length).toBeGreaterThan(0);
    // The file of a test's annotate call is copied too: Vitest keeps its own copy in its folder, and the results file
    // must not point there, or the file would not move with its folder (V-D101, the owner's portability rule).
    expect(paths.every((path) => path.startsWith('vitest-results-attachments/'))).toBe(true);
    expect(paths.some((path) => path.includes('annotated_file'))).toBe(true);
    expect(written).not.toContain(TOKEN);
  });

  it('never overwrites the file: a later run writes the next free sibling', async () => {
    expect(again.stderr).toContain(join(workspace.dir, NEXT_FILE));
    const next = await readFile(join(workspace.dir, NEXT_FILE), 'utf8');
    expect(next).not.toBe(written);
    // The file the first run wrote is kept as it was, until the import sends it.
    expect(kept).toBe(written);
  });

  it('sends the file later with the entries and files a direct run sends', () => {
    expect(imported.exitCode).toBe(0);
    expect(entriesOf(later)).toEqual(entriesOf(direct));
    expect(filesOf(later)).toEqual(filesOf(direct));
    expect(filesOf(later).length).toBeGreaterThan(0);
    expect(imported.stdout + imported.stderr).not.toContain(TOKEN);
  });

  it('imports the same files after its folder moves and the attachments folder of Vitest is gone', async () => {
    // Another machine: the results folder is moved, and nothing of Vitest's attachments folder is left. The first file
    // was imported above (an import removes its file), so this is the second run's file, which still waits with its copies.
    await rename(join(workspace.dir, 'results'), join(workspace.dir, 'moved'));
    await rm(join(workspace.dir, 'attachments'), { recursive: true, force: true });
    const elsewhere = await startFakeProbara({ token: TOKEN });
    fakes.push(elsewhere);
    const run = await workspace.probara(
      ['import', 'results', join('moved', basename(NEXT_FILE))],
      probaraEnv(elsewhere.baseUrl),
    );
    expect(run.exitCode).toBe(0);
    expect(run.stdout + run.stderr).not.toContain('missing');
    expect(filesOf(elsewhere)).toEqual(filesOf(direct));
    expect(entriesOf(elsewhere)).toEqual(entriesOf(direct));
  });
});
