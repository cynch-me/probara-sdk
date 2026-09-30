/**
 * Builds `@probara/core`, then the CLI, before the tests when their sources changed: the smoke
 * tests spawn the built bin, and CI runs `pnpm test` before `pnpm build` on a fresh clone. Other
 * packages' tests build them too, at the same time: one process builds, the others wait for it.
 */
import { buildWhenStale, CLI_BUILD, CORE_BUILD } from '@probara/test-support/build';

export default async function setup(): Promise<void> {
  await buildWhenStale(CORE_BUILD);
  await buildWhenStale(CLI_BUILD);
}
