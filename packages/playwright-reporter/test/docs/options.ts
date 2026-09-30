/**
 * The real option list of the reporter, read from its types with the TypeScript compiler
 * (`@probara/test-support/docs/options`): every property of `ProbaraPlaywrightOptions`, and every
 * `PROBARA_*` variable the source of core and of the reporter reads.
 */
import { join } from 'node:path';
import {
  optionsOf,
  variablesInSource as variablesIn,
  type OptionEntry,
} from '@probara/test-support/docs/options';
import { PACKAGE_DIR } from './markdown.js';

export type { OptionEntry } from '@probara/test-support/docs/options';

/** Every option of `ProbaraPlaywrightOptions`, in declaration order. */
export function realOptions(): OptionEntry[] {
  return optionsOf(PACKAGE_DIR, 'ProbaraPlaywrightOptions');
}

/** Every `PROBARA_*` variable the source of core and of the reporter reads. */
export function variablesInSource(): string[] {
  return variablesIn([join(PACKAGE_DIR, 'src'), join(PACKAGE_DIR, '..', 'core', 'src')]);
}
