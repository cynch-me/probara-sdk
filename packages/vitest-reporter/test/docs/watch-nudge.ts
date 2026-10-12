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
