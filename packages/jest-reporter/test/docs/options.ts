/**
 * The real option list of the reporter, read from its types with the TypeScript compiler
 * (`@probara/test-support/docs/options`): every property of `ProbaraJestOptions`, and every
 * `PROBARA_*` variable the source of core and of the reporter reads.
 */
import { join } from 'node:path';
import {
  optionsOf,
  variablesInSource as variablesIn,
  type OptionEntry,
} from '@probara/test-support/docs/options';
import { PACKAGE_DIR } from './markdown.js';

/** Every option of `ProbaraJestOptions`, in declaration order. */
export function realOptions(): OptionEntry[] {
  return optionsOf(PACKAGE_DIR, 'ProbaraJestOptions');
}

/** Every `PROBARA_*` variable the source of core and of the reporter reads. */
export function variablesInSource(): string[] {
  return variablesIn([join(PACKAGE_DIR, 'src'), join(PACKAGE_DIR, '..', 'core', 'src')]);
}
