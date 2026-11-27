/**
 * The page captures of a recording: console, network, WebSockets and user events, each with the
 * site's sanitizers, the given URLs (such as an intake's own requests) and elements (such as a
 * recorder's overlay) left out.
 */
import type { BlurController } from './blur.js';
import { createConsoleCapture } from './console.js';
import { createNetworkCapture, type UrlPattern } from './network.js';
import type { Sanitizers } from './sanitize.js';
import type { RecordingSession } from './session.js';
import { createUserEventCapture } from './user-events.js';
import { createWebSocketCapture } from './websocket.js';

export interface PageCaptureOptions extends Sanitizers {
  ignoreUrls: readonly UrlPattern[];
  blur: BlurController;
  /** Elements whose events are not recorded: the recorder's overlay. */
  ignore: (element: Element) => boolean;
}

/** Starts every capture into `session`; `stop()` stops them all. Never throws. */
export function startPageCaptures(
  session: RecordingSession,
  options: PageCaptureOptions,
): { stop(): void } {
  const captures: { start(): void; stop(): void }[] = [];
  const add = (create: () => { start(): void; stop(): void }): void => {
    try {
      const capture = create();
      capture.start();
      captures.push(capture);
    } catch {
      // A capture that cannot start leaves the others running.
    }
  };
  const { logSanitizer, requestSanitizer, responseSanitizer, webSocketSanitizer } = options;
  add(() => createConsoleCapture(session, logSanitizer === undefined ? {} : { logSanitizer }));
  add(() =>
    createNetworkCapture(session, {
      ignoreUrls: options.ignoreUrls,
      ...(requestSanitizer === undefined ? {} : { requestSanitizer }),
      ...(responseSanitizer === undefined ? {} : { responseSanitizer }),
    }),
  );
  add(() =>
    createWebSocketCapture(session, {
      ignoreUrls: options.ignoreUrls,
      ...(requestSanitizer === undefined ? {} : { requestSanitizer }),
      ...(webSocketSanitizer === undefined ? {} : { webSocketSanitizer }),
    }),
  );
  add(() => createUserEventCapture(session, { blur: options.blur, ignore: options.ignore }));
  return {
    stop() {
      for (const capture of captures.splice(0)) {
        try {
          capture.stop();
        } catch {
          // Never throw into the page.
        }
      }
    },
  };
}
