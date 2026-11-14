/**
 * The page captures of a recording: console, network, WebSockets and user events, each through
 * the engine with the site's sanitizers, the intake's own requests and the overlay left out.
 */
import {
  createConsoleCapture,
  createNetworkCapture,
  createUserEventCapture,
  createWebSocketCapture,
  type BlurController,
  type RecordingSession,
  type Sanitizers,
  type UrlPattern,
} from '@probara/vis-capture';

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
