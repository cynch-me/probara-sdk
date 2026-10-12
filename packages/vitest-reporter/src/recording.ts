/**
 * The two pieces every setup file shares: the guard of one recording step (a failure costs the record, never the
 * test), and the count of a task's annotations (V-D68). Platform-neutral: the Node and the browser setup load it.
 */

/** How many annotations the test has now, when Vitest keeps them on the task (V-D68): `undefined` when it does not, so the files of its attempts are then left out rather than misattributed. */
export function annotationCountOf(task: object): number | undefined {
  const annotations: unknown = Reflect.get(task, 'annotations');
  return Array.isArray(annotations) ? annotations.length : undefined;
}

/** Runs one recording step; a failure of the reporter's own code costs the record, never the test. */
export function recording(step: () => void): void {
  try {
    step();
  } catch {
    // The attempt goes unrecorded: the test still runs, and the reporter falls back to its final state.
  }
}
