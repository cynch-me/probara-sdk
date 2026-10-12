/**
 * The setup file the reporter adds to every project's `setupFiles` (V-D5). It records each attempt
 * of a test in `task.meta.probara.attempts` (V-D10): the first `beforeEach` opens the attempt (it
 * runs before every user hook, once per attempt), and the `afterEach` measures its duration. It also
 * installs the slot the `probara.*` helpers read, so they find the running test even when the runner
 * extension is not wrapped. It never throws into a test.
 */
import { afterEach, beforeEach, inject } from 'vitest';
import { beginAttempt, endAttempt } from './attempts.js';
import { installCurrentTest } from './current-test.js';
import { FILES_KEY } from './files-key.js';
import { filesDirOf, installFilesDir } from './files-slot.js';

installCurrentTest();

/**
 * How many annotations the test has now, when Vitest keeps them on the task (V-D68): `undefined` when it does
 * not, so the files of its attempts are then left out rather than misattributed.
 */
function annotationCountOf(task: object): number | undefined {
  const annotations: unknown = Reflect.get(task, 'annotations');
  return Array.isArray(annotations) ? annotations.length : undefined;
}

/** Runs one recording step; a failure of the reporter's own code costs the record, never the test. */
function recording(step: () => void): void {
  try {
    step();
  } catch {
    // The attempt goes unrecorded: the test still runs, and the reporter falls back to its final state.
  }
}

recording(() => {
  installFilesDir(inject(FILES_KEY));
});

beforeEach(({ task }) => {
  recording(() => {
    task.meta.probara ??= {};
    // The folder of this run's copies, so a blob carries the place of the files it names (V-D66).
    const filesDir = filesDirOf();
    if (filesDir !== undefined) task.meta.probara.filesDir = filesDir;
    beginAttempt(
      task.meta.probara,
      task.result ?? {},
      {
        epochMs: Date.now(),
        perfMs: performance.now(),
      },
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
