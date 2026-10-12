/**
 * The notices this process has logged (V-D122). A notice describes the environment, such as the Vite the browser attach
 * uses, not one run: a watch session's re-runs log it once. The notices live on `globalThis` under a `Symbol.for` key,
 * where every copy of the reporter finds them, as the watch session does (`watch-runs.ts`).
 */
import type { Logger } from '@probara/core';

/** The key of the notices on `globalThis`: the same symbol for every copy of this package in the process. */
const NOTICES = Symbol.for('@probara/vitest-reporter/notices/v1');

/** Logs `notice` with `logger` the first time this process sees it; a later call with the same notice logs nothing. */
export function noticeOnce(notice: string, logger: Logger | undefined): void {
  // Without a logger the notice is not kept: the next call that has one logs it.
  if (logger === undefined) return;
  const holder = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  const logged = (holder[NOTICES] ??= new Set<string>());
  if (logged.has(notice)) return;
  // Kept once logged: a warning that throws leaves the notice for the next call.
  logger.warn(notice);
  logged.add(notice);
}
