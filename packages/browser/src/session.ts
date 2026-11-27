/**
 * The tab session: an id kept in `sessionStorage`, so it lasts while the tab does and reloads keep
 * it, and whether a replay was uploaded in it. In memory when the storage cannot be used.
 */
import { randomId } from '@probara/error-core';

const STORAGE_KEY = 'probara.session';

interface Stored {
  id: string;
  replay: boolean;
}

export interface TabSession {
  readonly id: string;
  replaySent(): boolean;
  markReplaySent(): void;
}

function read(): Stored | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(STORAGE_KEY) ?? 'null',
    ) as Partial<Stored> | null;
    return typeof value?.id === 'string' && /^[0-9a-f]{32}$/.test(value.id)
      ? { id: value.id, replay: value.replay === true }
      : null;
  } catch {
    return null;
  }
}

function write(stored: Stored): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage off or full: the session lives in memory.
  }
}

/** The session of this tab, started now unless one was kept. */
export function tabSession(): TabSession {
  const stored = read() ?? { id: randomId(), replay: false };
  write(stored);
  return {
    id: stored.id,
    replaySent: () => stored.replay || read()?.replay === true,
    markReplaySent() {
      stored.replay = true;
      write(stored);
    },
  };
}
