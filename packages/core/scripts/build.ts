/**
 * Builds `@probara/core` into `dist/` (`pnpm build`, after `sync-version`). Other packages' tests
 * that load the built core run it too.
 */
import { fileURLToPath } from 'node:url';
import { buildPackage } from './build-package.ts';

buildPackage(fileURLToPath(new URL('../dist', import.meta.url)));
