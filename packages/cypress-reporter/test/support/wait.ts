/**
 * Waiting for what a test observes, for the boundaries of this package that are asynchronous and
 * hand nothing back: a run without a `setupNodeEvents` has no plugin process to await, so the
 * reporter process sends its results itself and nothing waits for them.
 *
 * A fixed sleep is a race with the machine rather than with the code: the same test passes on a
 * laptop and fails on a CI runner that happens to be busy, and the failure says nothing about what
 * was being waited for. So the wait is for the condition, and the refusal names it.
 */

/** How long a wait lasts before it gives up, for a boundary that is a local HTTP call. */
const DEFAULT_TIMEOUT_MS = 5_000;
/** How often a wait looks: often enough that a refusal is quick, rarely enough to be quiet. */
const POLL_MS = 5;

/** How long to wait between checks, as a promise that takes it. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Resolves as soon as `holds` is true, and throws `what` was never true within `timeoutMs`: what a
 * test of an asynchronous boundary waits for, instead of a sleep it hopes is long enough.
 */
export async function until(
  holds: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + Math.max(timeoutMs, 0);
  for (;;) {
    if (await holds()) return;
    if (Date.now() >= deadline) throw new Error(`Gave up waiting for ${what}`);
    await pause(POLL_MS);
  }
}
