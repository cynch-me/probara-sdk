/**
 * The real `playwright test` on the fixture project, with the built reporter registered by its
 * package name, against a fake Probara. The same run writes a JUnit file, which the real
 * `probara import junit` sends to a second fake: both must give every test the same key.
 */
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entriesOf, FULL_RUN, labelsOf } from './support/expected.js';
import {
  createWorkspace,
  playwrightAtLeast,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 120_000;

describe('playwright test with the reporter', () => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let run: CommandRun;

  beforeAll(async () => {
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace();
    run = await workspace.playwright(['test', '--reporter=junit,@probara/playwright-reporter'], {
      ...probaraEnv(fake.baseUrl, { PROBARA_CAPTURE_OUTPUT: 'true' }),
      PLAYWRIGHT_JUNIT_OUTPUT_NAME: 'junit.xml',
    });
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('keeps the exit code of the tests and logs on stderr only, without the token', () => {
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toMatch(
      /\[probara\] Sending 42 results of 34 tests \(24 passed, 14 failed, 4 skipped, 0 blocked\)/,
    );
    expect(run.stderr).toMatch(/\[probara\] Recorded 46 results .* in R-1 \(closed\)/);
    expect(run.stdout).not.toContain('[probara]');
    expect(run.stdout + run.stderr).not.toContain(TOKEN);
  });

  it('reports every attempt with its status, keyed and linked like the JUnit import, in one run', () => {
    expect(entriesOf(fake.reports())).toEqual(FULL_RUN);
    expect(fake.runs().map((created) => created.state)).toEqual(['closed']);
  });

  it('writes the reason of a skip into the notes', () => {
    const notesOf = (title: string) =>
      fake
        .reports()
        .flatMap((report) => report.results)
        .filter((entry) => entry.automationKey?.includes(title) === true)
        .map((entry) => entry.notes);
    expect(notesOf('supports SSO')).toEqual([
      'Skipped: SSO provider not configured',
      'Skipped: SSO provider not configured',
    ]);
    expect(notesOf('remembers the device')).toEqual([undefined, undefined]);
  });

  it('uploads the attachments of each attempt: files, bodies, traces and error context', () => {
    // Playwright copies an attached file to `pixel-<sha1>.png`: it is named from the attachment.
    const names = fake.stagedFiles().map((file) => `${file.name} ${file.type}`);
    const count = (name: string) => names.filter((entry) => entry === name).length;
    // Once per named project.
    expect(count('pixel.png image/png')).toBe(2);
    expect(count('data.json application/json')).toBe(2);
    // Every attempt that started records a trace (a test that skips itself too, a fixme does not),
    // uploaded to the result of each case it links: 46 results, less the 2 fixme ones.
    expect(count('trace.zip application/zip')).toBe(44);
    // Playwright writes an error context for failed attempts: each one is uploaded.
    const contexts = readdirSync(join(workspace.dir, 'test-results'), { recursive: true }).filter(
      (path) => basename(String(path)) === 'error-context.md',
    );
    // Playwright writes it since 1.51 (the peer range starts earlier).
    if (playwrightAtLeast(1, 51)) expect(contexts.length).toBeGreaterThan(0);
    expect(count('error-context.md text/markdown')).toBe(contexts.length);
  });

  it('attaches stdout and stderr with PROBARA_CAPTURE_OUTPUT', () => {
    expect(fake.stagedFiles().filter((file) => file.name.endsWith('.log'))).toEqual([
      expect.objectContaining({
        name: 'stdout.log',
        type: 'text/plain',
        size: 'hello from stdout\n'.length,
      }),
      expect.objectContaining({
        name: 'stderr.log',
        type: 'text/plain',
        size: 'hello from stderr\n'.length,
      }),
      expect.objectContaining({
        name: 'stdout.log',
        type: 'text/plain',
        size: 'hello from stdout\n'.length,
      }),
      expect.objectContaining({
        name: 'stderr.log',
        type: 'text/plain',
        size: 'hello from stderr\n'.length,
      }),
    ]);
  });

  it('gives every test the key and cases of `probara import junit` on the same run', async () => {
    const junitFake = await startFakeProbara({ token: TOKEN });
    try {
      const imported = await workspace.probara(
        ['import', 'junit', 'junit.xml', '--no-attachments'],
        probaraEnv(junitFake.baseUrl),
      );
      expect(imported.stderr).toContain('junit.xml: playwright');
      expect(labelsOf(entriesOf(junitFake.reports()))).toEqual(labelsOf(FULL_RUN));
      expect(labelsOf(entriesOf(fake.reports()))).toEqual(labelsOf(entriesOf(junitFake.reports())));
    } finally {
      await junitFake.close();
    }
  });
});

describe('playwright test when reporting fails', () => {
  it(
    'keeps the exit code of the tests',
    async () => {
      const fake = await startFakeProbara({ token: TOKEN });
      fake.fail('report', { status: 422 });
      const workspace = await createWorkspace();
      try {
        const run = await workspace.playwright(
          ['test', '--reporter=@probara/playwright-reporter', '--grep', 'logs in with a valid'],
          probaraEnv(fake.baseUrl),
        );
        expect(run.exitCode).toBe(0);
        expect(run.stderr).toMatch(/\[probara\] 2 results were not sent/);
      } finally {
        await fake.close();
        await workspace.remove();
      }
    },
    TIMEOUT,
  );
});
