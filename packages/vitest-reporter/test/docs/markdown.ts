/** The reporter's user docs: its README, its changelog and every page of its `docs/`. */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageDocs } from '@probara/test-support/docs/markdown';

/** `packages/vitest-reporter/`. */
export const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));

export function userDocs(): string[] {
  return packageDocs(PACKAGE_DIR);
}

/** The configuration page: its options tables are checked against the reporter's options. */
export const CONFIGURATION_PAGE = join(PACKAGE_DIR, 'docs', 'configuration.md');
