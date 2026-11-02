/** The formatter's options: core's, read from the `probara` key of the Cucumber `formatOptions`. */
import {
  resolveAdapterSetup,
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

/**
 * The core options of a run: the formatter's options, with `rootDir` defaulting to the directory
 * Cucumber runs in (the one the feature paths are relative to), and the formatter's client name.
 */
export function resolveSetup(options: ProbaraCucumberOptions, cwd: string): AdapterSetup {
  return resolveAdapterSetup(options, { rootDir: cwd, clientName: CLIENT_NAME });
}
