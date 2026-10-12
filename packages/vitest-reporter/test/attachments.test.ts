/**
 * `probara.attach()` in real Vitest, against a fake Probara: the files and bodies a run uploads, by name,
 * type and content; a file after the body and one removed right after its call; the files of each attempt;
 * a shard whose copies are merged; a merge without the attachments folder; and `uploadAttachments: false`.
 * Real Vitest in each supported major, no runner mocks.
 */
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startFakeProbara,
  type FakeProbara,
  type FakeStagedFile,
} from '@probara/test-support/fake-probara';
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
const RECEIPT = fileURLToPath(new URL('./fixtures/attachments/files/receipt.txt', import.meta.url));

/** The SHA-256 of `content`, in hex: what the fake records of the bytes it received. */
function sha256Of(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** The files the fake received under `name`. */
function namedAs(files: readonly FakeStagedFile[], name: string): FakeStagedFile[] {
  return files.filter((file) => file.name === name);
}

/** Every file the fake received, as its name and its SHA-256, sorted: the same files, in any order. */
function fileSetOf(files: readonly FakeStagedFile[]): string[] {
  return files.map((file) => `${file.name} ${file.sha256}`).sort();
}

describe.each(VITEST_VERSIONS)('$name: probara.attach()', (vitest) => {
  let fake: FakeProbara;
  let merged: FakeProbara;
  let lost: FakeProbara;
  let off: FakeProbara;
  let workspace: Workspace;
  let withReporter: CommandRun;
  let lostOutput: string;

  beforeAll(async () => {
    await buildReporter();
    fake = await startFakeProbara({ token: TOKEN });
    merged = await startFakeProbara({ token: TOKEN });
    lost = await startFakeProbara({ token: TOKEN });
    off = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest, 'attachments');
    withReporter = await workspace.vitest(['run'], probaraEnv(fake.baseUrl));
    // A shard sends nothing without a token, and keeps its copies in the attachments folder for the merge.
    await workspace.vitest(['run', '--config', 'blob.config.mts', '--shard=1/1']);
    await workspace.vitest(['--merge-reports'], probaraEnv(merged.baseUrl));
    // The same merge once the attachments folder is not carried: the results are sent without their files.
    rmSync(join(workspace.dir, 'attachments'), { recursive: true, force: true });
    const lostRun = await workspace.vitest(['--merge-reports'], probaraEnv(lost.baseUrl));
    lostOutput = lostRun.stdout + lostRun.stderr;
    await workspace.vitest(
      ['run'],
      probaraEnv(off.baseUrl, { PROBARA_UPLOAD_ATTACHMENTS: 'false' }),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await Promise.all([fake.close(), merged.close(), lost.close(), off.close()]);
    await workspace.remove();
  });

  it('sends each file and body with its name, its content type and its content', () => {
    const staged = fake.stagedFiles();
    expect(namedAs(staged, 'receipt.txt')).toMatchObject([
      { type: 'text/plain', sha256: sha256Of(readFileSync(RECEIPT)) },
    ]);
    expect(namedAs(staged, 'order.json')).toMatchObject([
      { type: 'application/json', sha256: sha256Of('{"id":1042}') },
    ]);
    expect(namedAs(staged, 'log.txt')).toMatchObject([
      { type: 'text/plain', sha256: sha256Of('paid in 1.2 s') },
    ]);
  });

  it('sends the files attached after the body, in afterEach and in onTestFinished', () => {
    const staged = fake.stagedFiles();
    expect(namedAs(staged, 'after-each.txt')).toMatchObject([
      { sha256: sha256Of('written in afterEach') },
    ]);
    expect(namedAs(staged, 'on-finished.txt')).toMatchObject([
      { sha256: sha256Of('written in onTestFinished') },
    ]);
  });

  it('sends a file removed right after its call, with the content it had then', () => {
    expect(namedAs(fake.stagedFiles(), 'vanishing.txt')).toMatchObject([
      { sha256: sha256Of('gone before the reporter reads it') },
    ]);
  });

  it('leaves out a file over 32 MiB, with a warning, and sends the results of the run', () => {
    expect(namedAs(fake.stagedFiles(), 'huge.bin')).toEqual([]);
    expect(withReporter.stdout + withReporter.stderr).toContain(
      'did not attach "huge": it is larger than 32 MiB',
    );
    expect(fake.reports().length).toBeGreaterThan(0);
  });

  it('sends the files of each attempt of a retried test, each one once', () => {
    const staged = fake.stagedFiles();
    expect(namedAs(staged, 'attempt-1.txt')).toHaveLength(1);
    expect(namedAs(staged, 'attempt-2.txt')).toHaveLength(1);
  });

  it('keeps the files of a shard through a blob and --merge-reports', () => {
    expect(namedAs(merged.stagedFiles(), 'receipt.txt')).toMatchObject([
      { sha256: sha256Of(readFileSync(RECEIPT)) },
    ]);
    expect(fileSetOf(merged.stagedFiles())).toEqual(fileSetOf(fake.stagedFiles()));
  });

  it('sends the merged results without their files when the attachments folder is not carried, and says so', () => {
    expect(lost.stagedFiles()).toEqual([]);
    expect(lost.reports().length).toBeGreaterThan(0);
    expect(lostOutput).toContain('Skipped an attachment: its file is missing or unreadable');
  });

  it('uploads no file when uploadAttachments is off, and sends the results', () => {
    expect(off.stagedFiles()).toEqual([]);
    expect(off.reports().length).toBeGreaterThan(0);
  });
});
