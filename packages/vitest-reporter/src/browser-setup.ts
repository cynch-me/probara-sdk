/**
 * The setup of a browser project (V10): what the Node setup file does (each attempt recorded in `task.meta`, the files
 * folder, the slot the `probara.*` helpers read), with what a browser cannot do the Node way. A browser has no
 * AsyncLocalStorage, so the running test is Vitest's own, and a concurrent test is never exact: its helpers are dropped
 * with a warning (V-D53). The copy of a file is the `probaraAttach` command (`browser-commands.ts`). No run selection
 * here: it needs the core's main entry, which a browser cannot load, so a browser project runs every test (V-D102).
 * Each Vitest major passes its own accessors in (`setup-browser.ts`, `setup-browser-v3.ts`): their specifiers differ.
 */
import { afterEach, beforeEach, inject } from 'vitest';
import { beginAttempt, endAttempt } from './attempts.js';
import { BROWSER_COMMANDS_KEY } from './browser-commands.js';
import {
  CURRENT_TEST_SLOT,
  type CurrentTest,
  type CurrentTestSlot,
  type RunningTest,
} from './current-test-slot.js';
import { FILES_KEY } from './files-key.js';
import { filesDirOf, installFilesDir } from './files-slot.js';
import { annotationCountOf, recording } from './recording.js';

/** What a major's browser setup file gives this one: the commands of the browser, and Vitest's running test. */
export interface BrowserSetupParts {
  readonly commands: unknown;
  /** Vitest's current test, as its accessor reports it while a test runs (`undefined` between tests). */
  readonly currentTest: () => unknown;
}

/** Whether a value is a running test as the helpers read it: an object with a name and a meta record. */
function isRunningTest(value: unknown): value is RunningTest {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'name') === 'string' &&
    typeof Reflect.get(value, 'meta') === 'object'
  );
}

/** Whether the warning of a running-test accessor that throws is printed: once per worker (V-D59). */
let accessorWarned = false;

/**
 * The running test as Vitest's accessor reports it (`getCurrentTest`, which a later Vitest may move or make throw): the
 * test, or `undefined` between tests and when the accessor throws. A throw costs the helpers their calls, with one warning
 * per worker, and never the test that calls them.
 */
export function runningTestOf(read: () => unknown): RunningTest | undefined {
  try {
    const test = read();
    return isRunningTest(test) ? test : undefined;
  } catch (error) {
    if (!accessorWarned) {
      accessorWarned = true;
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[probara] the probara.* helpers cannot see the running test: ${reason}`);
    }
    return undefined;
  }
}

/** Installs the slots the helpers read and records every attempt; runs once per test file, in the browser. */
export function installBrowserSetup({ commands, currentTest }: BrowserSetupParts): void {
  const slot: CurrentTestSlot = {
    current(): CurrentTest | undefined {
      const test = runningTestOf(currentTest);
      return test === undefined ? undefined : { test, exact: false };
    },
  };
  Reflect.set(globalThis, CURRENT_TEST_SLOT, slot);
  Reflect.set(globalThis, BROWSER_COMMANDS_KEY, commands);
  recording(() => {
    installFilesDir(inject(FILES_KEY));
  });
  beforeEach((context) => {
    recording(() => {
      const { task } = context;
      task.meta.probara ??= {};
      // The folder of this run's copies, so a blob carries the place of the files it names (V-D66).
      const filesDir = filesDirOf();
      if (filesDir !== undefined) task.meta.probara.filesDir = filesDir;
      beginAttempt(
        task.meta.probara,
        task.result ?? {},
        { epochMs: Date.now(), perfMs: performance.now() },
        annotationCountOf(task),
      );
    });
  });
  afterEach(({ task }) => {
    recording(() => {
      if (task.meta.probara !== undefined) {
        endAttempt(task.meta.probara, { perfMs: performance.now() });
      }
    });
  });
}
