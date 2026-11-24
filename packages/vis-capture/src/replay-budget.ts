/**
 * When a replay pauses on a busy page, and when it resumes. A pause only pays when the page stays
 * busy: a navigation's burst is over before a pause would save anything, and resuming costs a full
 * snapshot of the page, about 190 ms for a 35,000-node table. So a replay pauses once its work on
 * DOM changes went over the budget in several windows in a row, and resumes once a whole window
 * changes the page little enough to fit the budget again, or after its longest wait.
 */

/**
 * How much main-thread time a replay may spend on DOM changes in a window, how many busy windows in
 * a row pause it, and the longest its first pause lasts.
 */
export interface ReplayBudget {
  windowMs: number;
  mainThreadMs: number;
  busyWindows: number;
  pauseMs: number;
}

/**
 * The budget for a replay that runs all the time: three windows of 2 s in a row with more than
 * 100 ms each on DOM changes, 5% of the main thread, then a pause of at most 10 s. Measured on a
 * laptop: opening a 200-row Angular table costs rrweb about 90 ms once, while a page re-rendering
 * a 6,000-cell table every 400 ms costs it about 60 ms each time.
 */
export const REPLAY_BUDGET: Readonly<ReplayBudget> = Object.freeze({
  windowMs: 2_000,
  mainThreadMs: 100,
  busyWindows: 3,
  pauseMs: 10_000,
});

/** What the meter measured when it called the page busy. */
export interface BusyPage {
  /** The main-thread time spent on DOM changes in the busy windows. */
  mainThreadMs: number;
}

/**
 * Counts a replay's work on DOM changes in consecutive windows of `budget.windowMs`. Changes are
 * weighed by the nodes they add or remove (one at least), which the page tells without rrweb: once
 * busy, the main-thread time per unit of weight prices the changes made during the pause.
 */
export interface BusyMeter {
  /** The page changed `weight` at `at`, while recording or paused. */
  changed(at: number, weight: number): void;
  /**
   * rrweb spent `ms` on DOM changes at `at`: the page is busy once that goes over
   * `mainThreadMs` in `busyWindows` windows in a row, and the meter then waits for calm.
   */
  spent(at: number, ms: number): BusyPage | null;
  /**
   * Once busy, at the end of each window: whether the changes since the last call, at the price
   * measured while busy, fit the budget.
   */
  calm(): boolean;
  /** Starts the windows over at `at`. */
  reset(at: number): void;
}

export function createBusyMeter(budget: Readonly<ReplayBudget>, start: number): BusyMeter {
  let origin = start;
  let index = 0;
  let windowMs = 0;
  let windowWeight = 0;
  /** The busy windows right before the current one. */
  let streak = { windows: 0, ms: 0, weight: 0 };
  let busy = false;
  let msPerWeight = 0;
  let calmWeight = 0;

  function advance(at: number): void {
    const next = Math.floor((at - origin) / budget.windowMs);
    if (next <= index) return;
    streak =
      next === index + 1 && windowMs > budget.mainThreadMs
        ? {
            windows: streak.windows + 1,
            ms: streak.ms + windowMs,
            weight: streak.weight + windowWeight,
          }
        : { windows: 0, ms: 0, weight: 0 };
    index = next;
    windowMs = 0;
    windowWeight = 0;
  }

  return {
    changed(at, weight) {
      if (busy) {
        calmWeight += weight;
        return;
      }
      advance(at);
      windowWeight += weight;
    },
    spent(at, ms) {
      if (busy) return null;
      advance(at);
      windowMs += ms;
      if (windowMs <= budget.mainThreadMs || streak.windows + 1 < budget.busyWindows) return null;
      const spent = streak.ms + windowMs;
      busy = true;
      msPerWeight = spent / Math.max(1, streak.weight + windowWeight);
      calmWeight = 0;
      return { mainThreadMs: spent };
    },
    calm() {
      const fits = calmWeight * msPerWeight <= budget.mainThreadMs;
      calmWeight = 0;
      return fits;
    },
    reset(at) {
      origin = at;
      index = 0;
      windowMs = 0;
      windowWeight = 0;
      streak = { windows: 0, ms: 0, weight: 0 };
      busy = false;
      calmWeight = 0;
    },
  };
}
