/**
 * Builds `@probara/core` into `dist/` (`pnpm build`, after `sync-version`). The tests of the CLI and
 * of each reporter, which load the built core, run it too, when core changed
 * (`@probara/test-support/build`).
 */
import { fileURLToPath } from 'node:url';
import { buildPackage } from './build-package.ts';

buildPackage(fileURLToPath(new URL('../dist', import.meta.url)));
