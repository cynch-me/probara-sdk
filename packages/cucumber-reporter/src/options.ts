/** The formatter's options: core's, read from the `probara` key of the Cucumber `formatOptions`. */
import {
  resolveAdapterSetup,
  splitCoreOptions,
  type AdapterSetup,
  type ProbaraOptions,
  type RuntimeOptions,
} from '@probara/core';
import { VERSION } from './version.js';

/** Sent first in the User-Agent. */
export const CLIENT_NAME = `probara-cucumber-reporter/${VERSION}`;

/**
 * The options of the formatter, under `formatOptions.probara` in the Cucumber configuration (or
 * `--format-options '{"probara":{...}}'`): every option of `@probara/core` under the same name. Each
 * falls back to its `PROBARA_*` variable, then to its default.
 */
export interface ProbaraCucumberOptions extends ProbaraOptions, RuntimeOptions {}

/** What the formatter needs once Cucumber began the run: core's setup, and its warnings. */
export interface Setup extends AdapterSetup {
  /** Problems of the options that leave reporting on: an option the formatter does not know. */
  warnings: string[];
}

/**
 * The core options of a run: the formatter's options, with `rootDir` defaulting to the directory
 * Cucumber runs in (the one the feature paths are relative to), and the formatter's client name.
 * An option the formatter does not know is left out with a warning, as Jest and Cypress do.
 */
export function resolveSetup(options: ProbaraCucumberOptions, cwd: string): Setup {
  const { core, warnings } = splitCoreOptions(options, '@probara/cucumber-reporter');
  return { ...resolveAdapterSetup(core, { rootDir: cwd, clientName: CLIENT_NAME }), warnings };
}
