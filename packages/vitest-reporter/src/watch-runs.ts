/**
 * The runs of the watch session of this process (V-D6). Vitest's watch mode runs every re-run in the same process, and a
 * server restart (a change of the config) instantiates the reporter again, so the session cannot live in this module's
 * state: it lives on `globalThis`, under a `Symbol.for` key, where every copy of the reporter finds it (J R-J2 W5).
 */
import { createSessionRuns, type SessionRuns } from '@probara/core';

/** The key of the session on `globalThis`: the same symbol for every copy of this package in the process. */
const SESSION = Symbol.for('@probara/vitest-reporter/watch-runs/v1');

/** The runs of the watch session: created once per process, the first time a watch run needs them. */
export function watchRuns(): SessionRuns {
  const holder = globalThis as unknown as Record<symbol, SessionRuns | undefined>;
  holder[SESSION] ??= createSessionRuns();
  return holder[SESSION];
}
