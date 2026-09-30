/**
 * Builds `@probara/core`, `@probara/cli` and the reporter before the tests when their sources
 * changed: the end-to-end tests run the real `playwright test`, which loads the built reporter
 * (and core through it), and the key compatibility test runs the built `probara` bin. CI runs
 * `pnpm test` before `pnpm build` on a fresh clone. Other packages' tests build core and the CLI
 * too, at the same time: one process builds, the others wait for it.
 */
import { fileURLToPath } from 'node:url';
import { buildWhenStale, CLI_BUILD, CORE_BUILD, tscBuild } from '@probara/test-support/build';

export default async function setup(): Promise<void> {
  await buildWhenStale(CORE_BUILD);
  await buildWhenStale(CLI_BUILD);
  await buildWhenStale(tscBuild(fileURLToPath(new URL('../../', import.meta.url))));
}
