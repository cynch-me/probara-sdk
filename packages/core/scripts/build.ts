/**
 * Builds `@probara/core` into `dist/` (`pnpm build`, after `sync-version`). The tests of the CLI and
 * of each reporter, which load the built core, run it too, when core changed
 * (`@probara/test-support/build`).
 *
 * `CORE_BUILD` in `packages/test-support/src/build.ts` mirrors this build: its inputs are what this
 * script reads (every file of `scripts/`, the sources, the tsconfigs, `package.json`, TypeScript)
 * and its outputs some files it writes. When this script comes to read a file outside those, or
 * stops writing one of those outputs, change `CORE_BUILD` with it: the tests would run on a stale
 * core otherwise.
 */
import { fileURLToPath } from 'node:url';
import { buildPackage } from './build-package.ts';

buildPackage(fileURLToPath(new URL('../dist', import.meta.url)));
