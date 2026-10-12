/**
 * The runner extension the reporter registers in every project (V-D7). It runs each test file like
 * the user's own runner, which the config names and the reporter keeps (its path comes through
 * `CUSTOM_RUNNER_KEY`), or like Vitest's default runner. It adds nothing to the run yet: the helpers
 * find the running test through this class.
 *
 * The default runner is `TestRunner` from `vitest` on 4.1 and later, `VitestTestRunner` from
 * `vitest/runners` before. The subpath is a variable: a literal `import()` of it fails the transform
 * of this module on Vitest 5, which has no such subpath, even when the branch is not taken.
 */
import { pathToFileURL } from 'node:url';
import * as vitest from 'vitest';
import type { SerializedConfig } from 'vitest';
import { CUSTOM_RUNNER_KEY } from './runner-key.js';

/** A runner class: Vitest constructs it with the serialized config. */
type RunnerClass = new (config: SerializedConfig) => object;

const RUNNERS_SUBPATH = 'vitest/runners';

/** The class the extension extends: the user's runner when the config names one, else the default. */
async function baseRunner(): Promise<RunnerClass> {
  const custom = vitest.inject(CUSTOM_RUNNER_KEY);
  if (custom !== '') {
    const loaded = (await import(pathToFileURL(custom).href)) as { default?: unknown };
    if (typeof loaded.default !== 'function') {
      throw new Error(`the runner ${custom} has no default class to extend`);
    }
    return loaded.default as RunnerClass;
  }
  if ('TestRunner' in vitest) return vitest.TestRunner;
  const runners = (await import(RUNNERS_SUBPATH)) as { VitestTestRunner: RunnerClass };
  return runners.VitestTestRunner;
}

const Base = await baseRunner();

/** The runner Vitest runs each test file with: the user's own class, or the default one, as it is. */
export default class ProbaraTestRunner extends Base {}
