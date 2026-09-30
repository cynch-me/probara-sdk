/**
 * Builds `@probara/core` (both its ES module and CommonJS builds: Jest loads the reporter, and
 * core through it, with `require`), `@probara/cli` and the reporter before the tests when their
 * sources changed: the end-to-end tests run the real `jest`, which loads the built reporter, and
 * the key parity test runs the built `probara` bin. CI runs `pnpm test` before `pnpm build` on a
 * fresh clone. Other packages' tests build core and the CLI too, at the same time: one process
 * builds, the others wait for it.
 */
import { join } from 'node:path';
import { buildWhenStale, CLI_BUILD, CORE_BUILD, tscBuild } from '@probara/test-support/build';

export default async function setup(): Promise<void> {
  await buildWhenStale(CORE_BUILD);
  await buildWhenStale(CLI_BUILD);
  await buildWhenStale(tscBuild(join(__dirname, '..', '..')));
}
