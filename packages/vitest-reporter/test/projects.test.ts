/**
 * Vitest projects, in each supported major, against a fake Probara (V8, V-D13): a file that two projects run is
 * reported once per project, with the same automation key, and the project of each result as a `project`
 * parameter. The project never enters the key, as in the JUnit import.
 */
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
