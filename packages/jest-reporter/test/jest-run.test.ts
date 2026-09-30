/**
 * The real `jest`, in each supported version, on the fixture project, with the built reporter
 * registered by its package name next to jest-junit, against a fake Probara. The real `probara
 * import junit` sends the jest-junit file of the same run to a second fake: both must give every
 * test the same key and cases, with the file attribute and `keyIncludesFile`, and without both.
 */
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  entriesOf,
  FULL_RUN,
  FULL_RUN_WITHOUT_FILE,
  labelsOf,
  type Entries,
} from './support/expected.js';
import {
  createWorkspace,
  JEST_VERSIONS,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 120_000;

function resultsOf(fake: FakeProbara) {
  return fake.reports().flatMap((report) => report.results);
}

/**
 * The entries `probara import junit` sends for the jest-junit file of `workspace`: the same keys and
 * cases as the reporter's `expected`, with two statuses of jest-junit's own. It writes a todo as
 * passed, and a retried test once, with the status of its last attempt.
 */
async function importedEntries(workspace: Workspace, expected: Entries): Promise<Entries> {
  const junitFake = await startFakeProbara({ token: TOKEN });
  try {
    const imported = await workspace.probara(
      ['import', 'junit', 'junit.xml'],
      probaraEnv(junitFake.baseUrl),
    );
    expect(imported.stderr).toContain('junit.xml: jest');
    expect(imported.exitCode).toBe(0);
    const entries = entriesOf(junitFake.reports());
    const statusOf = (title: string) =>
      Object.entries(entries).find(([label]) => label.includes(title))?.[1];
    expect(statusOf('remembers the device')).toEqual(['passed']);
    expect(statusOf('is flaky and passes on retry')).toEqual(['passed']);
    expect(labelsOf(entries)).toEqual(labelsOf(expected));
    return entries;
  } finally {
    await junitFake.close();
  }
}

describe.each(JEST_VERSIONS)('$name with the reporter, in workers', (jest) => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let run: CommandRun;

  beforeAll(async () => {
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(jest);
    run = await workspace.jest(['--maxWorkers=2'], {
      ...probaraEnv(fake.baseUrl),
      JEST_JUNIT_ADD_FILE_ATTRIBUTE: 'true',
    });
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('keeps the exit code of the tests and logs on stderr only, without the token', () => {
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toMatch(
      /\[probara\] Sending 15 results of 14 tests \(10 passed, 3 failed, 2 skipped, 0 blocked\)/,
    );
    expect(run.stderr).toMatch(/\[probara\] Recorded 15 results .* in R-1 \(closed\)/);
    expect(run.stdout).not.toContain('[probara]');
    expect(run.stdout + run.stderr).not.toContain(TOKEN);
  });

  it('warns about the test file Jest could not run, naming it', () => {
    expect(run.stderr).toMatch(
      /\[probara\] Could not report tests\/broken\.test\.js: Jest could not run it \(.+\)/,
    );
  });

  it('reports every attempt with its status, keyed with the file, in one run', () => {
    expect(entriesOf(fake.reports())).toEqual(FULL_RUN);
    expect(fake.runs().map((created) => created.state)).toEqual(['closed']);
  });

  it('writes the failures into the notes without terminal colors, and a todo as Todo', () => {
    const notesOf = (title: string) =>
      resultsOf(fake)
        .filter((entry) => entry.automationKey?.endsWith(title) === true)
        .map((entry) => entry.notes);
    expect(notesOf('login rejects a wrong password')).toEqual([
      expect.stringMatching(/^Error: expect\(received\)\.toBe\(expected\)/),
    ]);
    expect(notesOf('login remembers the device')).toEqual(['Todo']);
    expect(notesOf('retries is flaky and passes on retry')).toEqual([
      expect.stringContaining('Expected: 2'),
      undefined,
    ]);
    expect(resultsOf(fake).some((entry) => entry.notes?.includes('\u001b') === true)).toBe(false);
  });

  it('sends when each test started and how long it took', () => {
    for (const entry of resultsOf(fake)) {
      expect(Date.parse(entry.executedAt ?? '')).toBeGreaterThan(Date.now() - TIMEOUT * 10);
    }
    const ran = resultsOf(fake).filter((entry) => entry.status !== 'skipped');
    expect(ran.every((entry) => typeof entry.durationMs === 'number')).toBe(true);
  });

  it('gives every test the key and cases of `probara import junit` on the jest-junit file with its file attribute', async () => {
    const imported = await importedEntries(workspace, FULL_RUN);
    expect(labelsOf(entriesOf(fake.reports()))).toEqual(labelsOf(imported));
    expect(labelsOf(imported)[0]).toMatch(/^tests\//);
  });

  it('gives each created case the suite of the JUnit import: its file', () => {
    expect(
      resultsOf(fake).find((entry) => entry.automationKey?.endsWith('pays by card') === true)
        ?.suitePath,
    ).toEqual(['tests/nested/checkout.test.js']);
  });
});

describe.each(JEST_VERSIONS)('$name with the reporter, in band', (jest) => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let run: CommandRun;

  beforeAll(async () => {
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(jest);
    run = await workspace.jest(
      ['--runInBand'],
      probaraEnv(fake.baseUrl, { PROBARA_KEY_INCLUDES_FILE: 'false' }),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('reports the same attempts, keyed without the file', () => {
    expect(run.exitCode).toBe(1);
    expect(entriesOf(fake.reports())).toEqual(FULL_RUN_WITHOUT_FILE);
  });

  it('gives every test the key and cases of `probara import junit` on the default jest-junit file', async () => {
    const imported = await importedEntries(workspace, FULL_RUN_WITHOUT_FILE);
    expect(labelsOf(entriesOf(fake.reports()))).toEqual(labelsOf(imported));
    expect(labelsOf(imported).some((label) => label.includes('tests/'))).toBe(false);
  });

  it('gives each created case the suite of the JUnit import without the file: its describe', () => {
    const suiteOf = (title: string) =>
      resultsOf(fake).find((entry) => entry.automationKey === title)?.suitePath;
    expect(suiteOf('checkout pays by card')).toEqual(['checkout']);
    expect(suiteOf('top-level test outside any describe')).toBeUndefined();
  });
});

describe.each(JEST_VERSIONS)('$name loading the reporter', (jest) => {
  it(
    'from an ES module config, by its package name',
    async () => {
      const fake = await startFakeProbara({ token: TOKEN });
      const workspace = await createWorkspace(jest);
      try {
        const run = await workspace.jest(
          ['--config', 'esm.config.mjs', 'tests/cart.test.js'],
          probaraEnv(fake.baseUrl),
        );
        expect(run.exitCode).toBe(0);
        expect(entriesOf(fake.reports())).toEqual({
          'cart adds an item | -': ['passed'],
          'cart WEB-7 keeps another project id in its title | -': ['passed'],
        });
      } finally {
        await fake.close();
        await workspace.remove();
      }
    },
    TIMEOUT,
  );

  it(
    'keeps the exit code of the tests when reporting fails',
    async () => {
      const fake = await startFakeProbara({ token: TOKEN });
      fake.fail('report', { status: 422 });
      const workspace = await createWorkspace(jest);
      try {
        const run = await workspace.jest(['tests/cart.test.js'], probaraEnv(fake.baseUrl));
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
