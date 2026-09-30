/** The reporter's user docs: its README, its changelog and every page of its `docs/`. */
import { fileURLToPath } from 'node:url';
import { packageDocs } from '@probara/test-support/docs/markdown';

/** `packages/playwright-reporter/`. */
export const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));

export function userDocs(): string[] {
  return packageDocs(PACKAGE_DIR);
}
