/** What the process tells about where an event happened: the runtime, the OS and the app. */
import { release, type } from 'node:os';
import type { ProbaraEvent } from '@probara/error-core';

/** `event` with the `runtime`, `os` and `app` contexts and the server name. */
export function withProcess(event: ProbaraEvent, serverName: string | undefined): ProbaraEvent {
  const startedAt = Date.now() - process.uptime() * 1000;
  const out: ProbaraEvent = {
    ...event,
    contexts: {
      runtime: { name: 'node', version: process.version },
      os: { name: type(), version: release() },
      app: {
        app_start_time: new Date(startedAt).toISOString(),
        app_memory: process.memoryUsage.rss(),
      },
      ...event.contexts,
    },
  };
  if (serverName !== undefined && out.server_name === undefined) out.server_name = serverName;
  return out;
}
