/** What the watch session knows about its last save, and whether the watcher has started a re-run for it (V-D118). */
export interface NudgeCheck {
  /** Milliseconds since the file was last saved. */
  readonly sinceSaveMs: number;
  /** The time a save may wait for its re-run before it is repeated. */
  readonly intervalMs: number;
  /** Whether Vitest printed a `RERUN` line after that save. */
  readonly startedSinceSave: boolean;
}

/** Whether the file must be saved again: the watcher may have missed the save, and no re-run has started for it. */
export function nudgeDue({ sinceSaveMs, intervalMs, startedSinceSave }: NudgeCheck): boolean {
  return sinceSaveMs > intervalMs && !startedSinceSave;
}

/** A save a run of the watch session waits on: when it was made, and how many `RERUN` labels Vitest had printed by then. */
export interface RunSave {
  /** When the file was saved (`Date.now()` time). */
  readonly at: number;
  /** The `RERUN` labels printed when the file was saved: only a later label answers that save. */
  readonly labels: number;
}

/**
 * The nudge state of one run of a watch session (V-D122). The save that precedes a run starts its state, and only the
 * labels printed after that save answer it, so an earlier run's labels never answer a later run's save. A repeated save
 * stays with its run: it moves the save time, and it is made only while no label has answered the run, so the labels it
 * records are the run's own.
 */
export class RunNudge {
  private saved: RunSave;

  constructor(saved: RunSave) {
    this.saved = saved;
  }

  /** Whether the save of the run must be repeated now: the interval passed, and no label answered the save. */
  due({ now, labels, intervalMs }: { now: number; labels: number; intervalMs: number }): boolean {
    return nudgeDue({
      sinceSaveMs: now - this.saved.at,
      intervalMs,
      startedSinceSave: labels > this.saved.labels,
    });
  }

  /** Records the repeated save of the run, made at `now` when `labels` labels had been printed. */
  repeat({ now, labels }: { now: number; labels: number }): void {
    this.saved = { at: now, labels };
  }
}
