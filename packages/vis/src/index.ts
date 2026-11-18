/**
 * `@probara/vis`: Probara Vis on a customer's own site. The custom metadata API, the in-page
 * recorder a recording link opens, and in-app reporting with a widget key (`createReporter`),
 * with automatic blur and the site's sanitizers, over the capture engine `@probara/vis-capture`. Importing it does nothing by itself: no listener, no global, no
 * request, until a function is called.
 */
export { BLUR_META_NAME, PRIVACY_SELECTORS } from './blur.js';
export type { RecorderState } from './controller.js';
export type { Locale } from './i18n.js';
export type { Refusal, ReporterTokenProvider } from './intake.js';
export type { LauncherPosition } from './launcher.js';
export { metadata } from './metadata.js';
export type { MetadataProvider } from './metadata.js';
export { isRecordingSupported, startRecorder, startRecorderFromUrl } from './recorder.js';
export type { Recorder, RecorderOptions } from './recorder.js';
export { createReporter } from './reporter.js';
export type { Reporter, ReporterMode, ReporterOptions, ReporterState } from './reporter.js';
export { RECORDING_TOKEN_PARAM } from './url.js';
export { VERSION } from './version.js';
export type {
  ConsoleEntry,
  LogSanitizer,
  RequestSanitizer,
  ResponseSanitizer,
  SanitizableRequest,
  SanitizableResponse,
  SanitizableWebSocketMessage,
  UrlPattern,
  WebSocketSanitizer,
} from '@probara/vis-capture';
