/**
 * The setup file the reporter adds to every project's `setupFiles` (V-D5). It records each attempt
 * of a test in `task.meta.probara.attempts` (V-D10): the first `beforeEach` opens the attempt (it
 * runs before every user hook, once per attempt), and the `afterEach` measures its duration. It
 * never throws into a test.
 */
import { afterEach, beforeEach } from 'vitest';
import { beginAttempt, endAttempt } from './attempts.js';

/** Runs one recording step; a failure of the reporter's own code costs the record, never the test. */
function recording(step: () => void): void {
  try {
    step();
  } catch {
    // The attempt goes unrecorded: the test still runs, and the reporter falls back to its final state.
  }
}

beforeEach(({ task }) => {
  recording(() => {
    task.meta.probara ??= {};
    beginAttempt(task.meta.probara, task.result ?? {}, {
      epochMs: Date.now(),
      perfMs: performance.now(),
    });
  });
});

afterEach(({ task }) => {
  recording(() => {
    if (task.meta.probara !== undefined) {
      endAttempt(task.meta.probara, { perfMs: performance.now() });
    }
  });
});
