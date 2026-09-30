/**
 * What the setup file (`@probara/jest-reporter/setup`) does in each test file: it tells the
 * reporter it runs there, then turns on what the reporter's settings ask for, with root hooks of
 * Jest: `runCasesOnly` (skips the tests that match no case of the run, before any runs) and
 * `captureOutput` (the console output of each test). Loaded inside the test sandbox: Node built-ins
 * only; run selection loads `selection.ts` (and `@probara/core/metadata`) when it is on.
 */
import { createOutputCapture } from './capture-output.js';
import { appendLine, readSettings, type RunSelection } from './channel.js';
import { currentTest, currentTestFile } from './current-test.js';

/** The root hooks a setup file registers (Jest's globals). */
export interface SetupHooks {
  beforeAll?: ((fn: () => void) => void) | undefined;
  beforeEach: (fn: () => void) => void;
  afterEach: (fn: () => void) => void;
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
    if (hooks === undefined) return;
    const { selection } = settings;
    const { beforeAll } = hooks;
    if (selection !== undefined && file !== undefined && beforeAll !== undefined) {
      // A root hook runs once Jest collected the tests of the file, before any of them.
      beforeAll(() => {
        deselect(context, selection, file, dir);
      });
    }
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

/**
 * Skips the tests of `file` that match no case of the run, and names them to the reporter, which
 * leaves them out of the report. Never throws: every test runs when anything fails.
 */
function deselect(context: SetupContext, selection: RunSelection, file: string, dir: string): void {
  try {
    const module = context.selection?.();
    if (module === undefined) return;
    const tests = module.deselectTests(context.global, module.createSelector(selection), file);
    if (tests !== undefined && tests.length > 0)
      appendLine(dir, { type: 'deselected', file, tests });
  } catch {
    // Never into Jest: what was skipped the reporter still leaves out (it never ran, and matches
    // no case of the run).
  }
}
