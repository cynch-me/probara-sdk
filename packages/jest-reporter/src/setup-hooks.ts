/**
 * What the setup file (`@probara/jest-reporter/setup`) does in each test file: it tells the
 * reporter it runs there, then turns on what the reporter's settings ask for, with root hooks of
 * Jest: `runCasesOnly` (skips the tests that match no case of the run, before any runs) and
 * `captureOutput` (the console output of each test). Loaded inside the test sandbox: Node built-ins
 * only; run selection loads `selection.ts` (and `@probara/core/metadata`) when it is on.
 */
import { createOutputCapture } from './capture-output.js';
import { appendLine, readSettings, type RunSelection, type SelectionOutcome } from './channel.js';
import { currentTest, currentTestFile } from './current-test.js';

/** The root hooks a setup file registers (Jest's globals). */
export interface SetupHooks {
  beforeAll?: ((fn: () => void) => void) | undefined;
  beforeEach: (fn: () => void) => void;
  afterEach: (fn: () => void) => void;
}

/** The hooks of `source`, when it has the ones every feature needs. */
function hooksIn(source: unknown): SetupHooks | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const { beforeAll, beforeEach, afterEach } = source as Partial<Record<keyof SetupHooks, unknown>>;
  if (typeof beforeEach !== 'function' || typeof afterEach !== 'function') return undefined;
  return {
    beforeEach: beforeEach as SetupHooks['beforeEach'],
    afterEach: afterEach as SetupHooks['afterEach'],
    ...(typeof beforeAll === 'function' ? { beforeAll: beforeAll as SetupHooks['beforeAll'] } : {}),
  };
}

/**
 * Jest's root hooks: the globals of the sandbox `global`, else what `loadGlobals` gives
 * (`require('@jest/globals')`, which Jest answers in every test file, with `injectGlobals: false`
 * too); none outside Jest. Never throws.
 */
export function jestHooksOf(
  global: typeof globalThis,
  loadGlobals: () => unknown,
): SetupHooks | undefined {
  const injected = hooksIn(global);
  if (injected !== undefined) return injected;
  try {
    return hooksIn(loadGlobals());
  } catch {
    return undefined;
  }
}

/** What run selection needs of `selection.ts`, loaded only when it is on. */
export type SelectionModule = Pick<
  typeof import('./selection.js'),
  'createSelector' | 'deselectTests'
>;

export interface SetupContext {
  /** The global object of the test sandbox. */
  global: typeof globalThis;
  /** Jest's hooks; none outside Jest. */
  hooks: SetupHooks | undefined;
  /** The channel directory, while the reporter runs; `undefined` makes the setup a no-op. */
  channel(): string | undefined;
  /** Loads run selection (`selection.ts`), when the settings ask for it. */
  selection?(): SelectionModule;
}

/** Sets up the test file of `context.global`. Silent without the reporter; never throws. */
export function installSetup(context: SetupContext): void {
  try {
    const dir = context.channel();
    if (dir === undefined) return;
    const file = currentTestFile(context.global);
    if (file !== undefined) appendLine(dir, { type: 'setup', file });
    const settings = readSettings(dir);
    const { hooks } = context;
    const { selection } = settings;
    if (selection !== undefined && file !== undefined) {
      const beforeAll = hooks?.beforeAll;
      // A root hook runs once Jest collected the tests of the file, before any of them.
      if (beforeAll === undefined) tellSelection(dir, file, { applied: false, reason: 'no-hook' });
      else
        beforeAll(() => {
          deselect(context, selection, file, dir);
        });
    }
    if (hooks === undefined) return;
    if (settings.captureOutput) {
      const capture = createOutputCapture({
        console: context.global.console,
        channel: () => context.channel(),
        currentTest: () => currentTest(context.global),
      });
      hooks.beforeEach(() => {
        capture.start();
      });
      hooks.afterEach(() => {
        capture.stop();
      });
    }
  } catch {
    // Never into Jest: the features of the setup file are off for this test file.
  }
}

/** Tells the reporter what the setup file did of `runCasesOnly` in `file`. Never throws. */
function tellSelection(dir: string, file: string, outcome: SelectionOutcome): void {
  try {
    appendLine(dir, { type: 'selection', file, ...outcome });
  } catch {
    // Never into Jest: the reporter then decides alone which tests of the file it reports.
  }
}

/**
 * Skips the tests of `file` that match no case of the run, and names them to the reporter, which
 * leaves them out of the report; or tells it why it skipped none. Never throws: every test runs
 * when anything fails.
 */
function deselect(context: SetupContext, selection: RunSelection, file: string, dir: string): void {
  let outcome: SelectionOutcome;
  try {
    const module = context.selection?.();
    outcome =
      module === undefined
        ? { applied: false, reason: 'failed' }
        : module.deselectTests(context.global, module.createSelector(selection), file);
  } catch {
    // Never into Jest: nothing was skipped.
    outcome = { applied: false, reason: 'failed' };
  }
  tellSelection(dir, file, outcome);
}
