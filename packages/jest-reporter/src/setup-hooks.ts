/**
 * What the setup file (`@probara/jest-reporter/setup`) does in each test file: it tells the
 * reporter it runs there, then turns on what the reporter's settings ask for, with root hooks of
 * Jest: `captureOutput` (the console output of each test). Loaded inside the test sandbox: Node
 * built-ins only.
 */
import { createOutputCapture } from './capture-output.js';
import { appendLine, readSettings } from './channel.js';
import { currentTest, currentTestFile } from './current-test.js';

/** The root hooks a setup file registers (Jest's globals). */
export interface SetupHooks {
  beforeEach(fn: () => void): void;
  afterEach(fn: () => void): void;
}

export interface SetupContext {
  /** The global object of the test sandbox. */
  global: typeof globalThis;
  /** Jest's hooks; none outside Jest. */
  hooks: SetupHooks | undefined;
  /** The channel directory, while the reporter runs; `undefined` makes the setup a no-op. */
  channel(): string | undefined;
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
