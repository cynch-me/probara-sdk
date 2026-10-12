/**
 * Vitest projects, in each supported major, against a fake Probara (V8, V-D13): a file that two projects run is
 * reported once per project, with the same automation key, and the project of each result as a `project`
 * parameter. The project never enters the key, as in the JUnit import.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

const TIMEOUT = 180_000;
const SHOP = 'tests/shop.test.ts > cart > adds an item';
const EMPTIES = 'tests/shop.test.ts > cart > empties the cart';
const ADMIN = 'tests/admin.test.ts > admin sees the orders';

describe.each(VITEST_VERSIONS)(
  '$name with two projects, one of them running a file the other runs too',
  (vitest) => {
    let fake: FakeProbara;
    let workspace: Workspace;
    let run: CommandRun;

    beforeAll(async () => {
      await buildReporter();
      fake = await startFakeProbara({ token: TOKEN });
      workspace = await createWorkspace(vitest, 'projects');
      run = await workspace.vitest(['run'], probaraEnv(fake.baseUrl));
    }, TIMEOUT);

    afterAll(async () => {
      await fake.close();
      await workspace.remove();
    });

    /** The results sent for one key, with the `project` parameter of each, in the order they were sent. */
    const projectsOf = (key: string): (string | undefined)[] =>
      fake
        .reports()
        .flatMap((report) => report.results)
        .filter((result) => result.automationKey === key)
        .map((result) => result.parameters?.project);

    it('sends a file both projects run once per project, with the same key', () => {
      expect(run.exitCode).toBe(0);
      expect(projectsOf(SHOP).sort()).toEqual(['smoke', 'unit']);
      expect(projectsOf(EMPTIES).sort()).toEqual(['smoke', 'unit']);
      expect(fake.reports().flatMap((report) => report.results)).toHaveLength(5);
    });

    it('sends a file one project runs with that project as its parameter', () => {
      expect(projectsOf(ADMIN)).toEqual(['unit']);
    });

    it('keeps the project out of the key: every key is the one the JUnit import gives', () => {
      const keys = fake
        .reports()
        .flatMap((report) => report.results.map((result) => result.automationKey));
      expect(keys.sort()).toEqual([ADMIN, EMPTIES, EMPTIES, SHOP, SHOP].sort());
      expect(keys.some((key) => key?.includes('unit') || key?.includes('smoke'))).toBe(false);
    });
  },
);

/** One Vitest project: a run of one project names no project in its results (R-V8, V-D84). */
const ONE_PROJECT = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['default', ['@probara/vitest-reporter', {}]],
    projects: [{ test: { name: 'unit', include: ['tests/*.test.ts'] } }],
  },
});
`;

describe.each(VITEST_VERSIONS)('$name with one project', (vitest) => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let run: CommandRun;

  beforeAll(async () => {
    await buildReporter();
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest, 'projects');
    await writeFile(join(workspace.dir, 'vitest.config.mts'), ONE_PROJECT);
    run = await workspace.vitest(['run'], probaraEnv(fake.baseUrl));
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('sends every result of the run with no project parameter, as the run has one project', () => {
    expect(run.exitCode).toBe(0);
    const results = fake.reports().flatMap((report) => report.results);
    expect(results).toHaveLength(3);
    expect(results.some((result) => result.parameters !== undefined)).toBe(false);
  });
});

/** A test of the `unit` project that sets its project itself, with `probara.parameters()` (R-V8). */
const OWN = 'tests/own.test.ts > keeps the project the user names';
const OWN_TEST = `import { probara } from '@probara/vitest-reporter';
import { it } from 'vitest';

it('keeps the project the user names', () => {
  probara.parameters({ project: 'mine' });
});
`;

describe.each(VITEST_VERSIONS)('$name with two projects and a project the user names', (vitest) => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let run: CommandRun;

  beforeAll(async () => {
    await buildReporter();
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest, 'projects');
    await writeFile(join(workspace.dir, 'tests/own.test.ts'), OWN_TEST);
    run = await workspace.vitest(['run'], probaraEnv(fake.baseUrl));
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('sends the project the user set with probara.parameters(), over the project of the run', () => {
    expect(run.exitCode).toBe(0);
    const own = fake
      .reports()
      .flatMap((report) => report.results)
      .filter((result) => result.automationKey === OWN);
    expect(own.map((result) => result.parameters?.project)).toEqual(['mine']);
  });
});
