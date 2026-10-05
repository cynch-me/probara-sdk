/** The reporter's user docs: its README, its changelog and every page of its `docs/`. */
import { join } from 'node:path';
import { packageDocs } from '@probara/test-support/docs/markdown';

/** `packages/cypress-reporter/`. */
export const PACKAGE_DIR = join(__dirname, '..', '..');

export function userDocs(): string[] {
  return packageDocs(PACKAGE_DIR);
}
