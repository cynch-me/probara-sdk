/**
 * The setup file the reporter adds to every project's `setupFiles` (V-D5). It records each attempt of a test in
 * `task.meta.probara.attempts` (V-D10): the first `beforeEach` opens the attempt (it runs before every user hook, once per
 * attempt), and the `afterEach` measures its duration. It also installs the slot the `probara.*` helpers read, so they find
 * the running test even when the runner extension is not wrapped. With `runCasesOnly`, the first `beforeEach` skips a test
 * outside the cases of the run before its body and before any user hook (V-D15). It never throws into a test: a failure of
 * its own code costs the record, or the selection, of that test only.
 */
import { afterEach, beforeEach, inject } from 'vitest';
import { beginAttempt, endAttempt } from './attempts.js';
import { installCurrentTest } from './current-test.js';
import { annotationCountOf, recording } from './recording.js';
import { FILES_KEY } from './files-key.js';
import { filesDirOf, installFilesDir } from './files-slot.js';
import {
  createTestSelector,
  SELECTION_KEY,
  selectionOf,
  type TestSelector,
} from './run-selection.js';

installCurrentTest();

/** The part of a Vitest suite the selection reads: its name, and the suite it is in (none for the file). */
interface NamedSuite {
  readonly name: string;
  readonly suite?: NamedSuite | undefined;
}

/**
 * The describes of a task, outermost first: the suites between it and its file, which is no describe. The walk stops at the
 * file itself, since a top-level describe has no suite above it (V-D15).
 */
function ancestorsOf(task: {
  readonly file: object;
  readonly suite?: NamedSuite | undefined;
}): string[] {
  const names: string[] = [];
  for (let node = task.suite; node !== undefined && node !== task.file; node = node.suite) {
    names.unshift(node.name);
  }
  return names;
}

/** The selection this worker decides with, cached by the value the reporter provided: a watch re-run may select other cases. */
let selection: { value: unknown; select: TestSelector | undefined; run: string } | undefined;

/**
 * The note of a test the cases of the run do not select (V-D15), or `undefined` when it belongs to the run, or when no
 * selection can be read: the test then runs, and the reporter says why. Never throws.
 */
function notInRunNote(task: {
  readonly name: string;
  readonly file: { readonly filepath: string };
  readonly suite?: NamedSuite | undefined;
}): string | undefined {
  try {
    const value: unknown = inject(SELECTION_KEY);
    if (selection === undefined || selection.value !== value) {
      const read = selectionOf(value);
      selection = {
        value,
        select: read === undefined ? undefined : createTestSelector(read),
        run: read?.run ?? '',
      };
    }
    if (selection.select === undefined) return undefined;
    const selected = selection.select(task.file.filepath, ancestorsOf(task), task.name);
    return selected ? undefined : `Not in run ${selection.run}`;
  } catch {
    return undefined;
  }
}

recording(() => {
  installFilesDir(inject(FILES_KEY));
});

beforeEach((context) => {
  // runCasesOnly (V-D15): a test outside the cases of the run is skipped here, before its body and before any user hook.
  const note = notInRunNote(context.task);
  if (note !== undefined) context.skip(note);
  recording(() => {
    const { task } = context;
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
