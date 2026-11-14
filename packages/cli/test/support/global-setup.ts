/**
 * Builds `@probara/core` and `@probara/vis-capture`, then the CLI, before the tests when their
 * sources changed: the smoke tests spawn the built bin, which loads both, and CI runs `pnpm test`
 * before `pnpm build` on a fresh clone. Other packages' tests build them too, at the same time: one
 * process builds, the others wait for it.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildWhenStale,
  CLI_BUILD,
  CORE_BUILD,
  type PackageBuild,
} from '@probara/test-support/build';

const VIS_CAPTURE_DIR = fileURLToPath(new URL('../../../vis-capture/', import.meta.url));

/** `@probara/vis-capture`, by its own `tsdown` build: its ES modules, scripts and types. */
const VIS_CAPTURE_BUILD: PackageBuild = {
  dir: VIS_CAPTURE_DIR,
  inputs: ['src', 'tsdown.config.ts', 'tsconfig.build.json', 'package.json'],
  outputs: ['dist/index.js', 'dist/index.d.ts'],
  build: () =>
    new Promise((resolve, reject) => {
      const tsdown = createRequire(join(VIS_CAPTURE_DIR, 'package.json')).resolve(
        'tsdown/package.json',
      );
      const child = spawn(process.execPath, [join(dirname(tsdown), 'dist', 'run.mjs')], {
        cwd: VIS_CAPTURE_DIR,
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tsdown failed in ${VIS_CAPTURE_DIR} (${String(code)})`));
      });
    }),
};

export default async function setup(): Promise<void> {
  await buildWhenStale(CORE_BUILD);
  await buildWhenStale(VIS_CAPTURE_BUILD);
  await buildWhenStale(CLI_BUILD);
}
