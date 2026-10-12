/**
 * The runner extension the reporter registers in every project (V-D7). It runs each test file like
 * the user's own runner, which the config names and the reporter keeps (its path comes through
 * `CUSTOM_RUNNER_KEY`), or like Vitest's default runner. Before each test it enters the test in the store
 * the `probara.*` helpers read (`current-test.ts`), so a concurrent test finds its own; the base runner's
 * hooks run as they would without the extension.
 *
 * The default runner is `TestRunner` from `vitest` on 4.1 and later, `VitestTestRunner` from
 * `vitest/runners` before. The subpath is a variable: a literal `import()` of it fails the transform
 * of this module on Vitest 5, which has no such subpath, even when the branch is not taken.
 */
import { pathToFileURL } from 'node:url';
import * as vitest from 'vitest';
import type { SerializedConfig } from 'vitest';
import { enterCurrentTest, installCurrentTest, leaveCurrentTest } from './current-test.js';
import type { RunningTest } from './current-test-slot.js';
import { CUSTOM_RUNNER_KEY } from './runner-key.js';

/** The hooks of a runner that the extension wraps: Vitest's own are optional on its interface. */
interface RunnerHooks {
  onBeforeRunTask?(test: RunningTest): unknown;
  onAfterRunTask?(test: RunningTest): unknown;
}

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

const Base: new (config: SerializedConfig) => RunnerHooks = await baseRunner();

installCurrentTest();

/** Whether a failure of the extension's own bookkeeping was already reported: once per worker. */
let bookkeepingReported = false;

/**
 * Runs one step of the extension's own bookkeeping. A failure costs the helpers that test, never the
 * test: the base runner's hook still runs as it would without the extension, and one warning says why.
 */
function bookkeeping(step: () => void): void {
  try {
    step();
  } catch (error) {
    if (bookkeepingReported) return;
    bookkeepingReported = true;
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[probara] the probara.* helpers cannot see the running test: ${reason}`);
  }
}

/** The runner Vitest runs each test file with: the user's own class, or the default one, wrapped. */
export default class ProbaraTestRunner extends Base {
  /** Enters the test for the helpers, then runs the base runner's hook as it is. */
  override async onBeforeRunTask(test: RunningTest): Promise<void> {
    bookkeeping(() => {
      enterCurrentTest(test);
    });
    await super.onBeforeRunTask?.(test);
  }

  /** Runs the base runner's hook as it is, then leaves the test, also when that hook throws. */
  override async onAfterRunTask(test: RunningTest): Promise<void> {
    try {
      await super.onAfterRunTask?.(test);
    } finally {
      bookkeeping(() => {
        leaveCurrentTest(test);
      });
    }
  }
}
