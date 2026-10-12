/**
 * Builds `@probara/core` and the reporter when their sources changed: the end-to-end tests run the
 * real Vitest, which loads the built reporter (and core through it), and the package test loads the
 * built package. Each end-to-end file calls it in `beforeAll`, not in a global setup: the unit tests
 * then run without a build. `buildWhenStale` lets one process build while the others wait.
 */
import { fileURLToPath } from 'node:url';
import { buildWhenStale, CORE_BUILD, tscBuild } from '@probara/test-support/build';

const REPORTER_BUILD = tscBuild(fileURLToPath(new URL('../../', import.meta.url)));

/** Builds core, then the reporter, unless their built files are current. */
export async function buildReporter(): Promise<void> {
  await buildWhenStale(CORE_BUILD);
  await buildWhenStale(REPORTER_BUILD);
}
