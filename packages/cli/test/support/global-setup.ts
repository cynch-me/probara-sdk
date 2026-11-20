/**
 * Builds `@probara/core` and `@probara/vis-capture`, then the CLI, before the tests when their
 * sources changed: the smoke tests spawn the built bin, which loads both, and CI runs `pnpm test`
 * before `pnpm build` on a fresh clone. The CLI's build names both as what it needs
 * (`CLI_BUILD.needs`). Other packages' tests build them too, at the same time: one process builds,
 * the others wait for it.
 */
import { buildWhenStale, CLI_BUILD } from '@probara/test-support/build';

export default async function setup(): Promise<void> {
  await buildWhenStale(CLI_BUILD);
}
