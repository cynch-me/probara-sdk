/**
 * `@probara/vis-capture`: the browser capture engine of Probara Vis, shared by the embeddable
 * SDK and the browser extension. Browser code only: no Node built-in and no dependency. The DOM
 * replay recorder, which needs rrweb, is the separate `@probara/vis-capture/replay` entry.
 */
export {
  BLUR_META_NAME,
  PRIVACY_SELECTORS,
  applyAutoBlur,
  metaBlurSelectors,
} from './auto-blur.js';
export { BLUR_ATTRIBUTE, DEFAULT_BLUR_RADIUS_PX, createBlurController } from './blur.js';
export type { BlurController, BlurControllerOptions } from './blur.js';
export { createConsoleCapture } from './console.js';
export type { ConsoleCapture, ConsoleCaptureOptions, ConsoleCaptureTarget } from './console.js';
export {
  CONSOLE_LEVELS,
  DIAGNOSTICS_FORMAT_VERSION,
  GRAPHQL_OPERATION_TYPES,
  NETWORK_KINDS,
  USER_EVENT_TYPES,
  isConsoleEntry,
  isNetworkEntry,
  isUserEventEntry,
  isWebSocketMessageEntry,
} from './entries.js';
export type {
  BodyOmittedReason,
  ConsoleEntry,
  ConsoleLevel,
  DiagnosticsEntry,
  EntryTime,
  GraphqlInfo,
  GraphqlOperationType,
  NetworkBody,
  NetworkEntry,
  NetworkKind,
  NetworkTiming,
  UserEventEntry,
  UserEventTarget,
  UserEventType,
  WebSocketDirection,
  WebSocketMessageEntry,
} from './entries.js';
export { collectEnvironment, parseUserAgent } from './environment.js';
export type {
  CapturedEnvironment,
  Dimensions,
  EnvironmentTarget,
  Software,
  VisEnvironment,
} from './environment.js';
export { graphqlHasErrors, graphqlOperation } from './graphql.js';
export type { GraphqlOperation, GraphqlRequest } from './graphql.js';
export {
  DEFAULT_METADATA_TIMEOUT_MS,
  MAX_METADATA_BYTES,
  MAX_METADATA_DEPTH,
  METADATA_PROTOCOL_VERSION,
  METADATA_REQUEST_EVENT,
  METADATA_RESPONSE_EVENT,
  answerMetadataRequests,
  normalizeMetadata,
  requestPageMetadata,
} from './metadata.js';
export type {
  AnswerMetadataOptions,
  MetadataEventTarget,
  RequestMetadataOptions,
  VisMetadata,
} from './metadata.js';
export { gzipNdjson, toNdjson } from './ndjson.js';
export { startPageCaptures } from './page-captures.js';
export type { PageCaptureOptions } from './page-captures.js';
export { createNetworkCapture, matchesUrl } from './network.js';
export type {
  NetworkCapture,
  NetworkCaptureOptions,
  NetworkCaptureTarget,
  UrlPattern,
} from './network.js';
export { DEFAULT_BODY_LIMITS } from './network-body.js';
export type { BodyLimits } from './network-body.js';
export {
  AUDIO_BITRATE,
  CAPTURE_FRAME_RATE,
  DEFAULT_TIMESLICE_MS,
  DEFAULT_VIDEO_BITRATE_1440P,
  MAX_CAPTURE_HEIGHT,
  MAX_CAPTURE_WIDTH,
  MIN_VIDEO_BITRATE,
  createVideoRecorder,
  displayCaptureConstraints,
  pickVideoFormat,
  videoBitrate,
} from './recorder.js';
export type {
  DisplayCaptureOptions,
  VideoChunkSink,
  VideoFormat,
  VideoRecorder,
  VideoRecorderOptions,
  VideoRecorderState,
  VideoRecordingResult,
  VideoStopReason,
} from './recorder.js';
export { REDACTED, redactBody, redactHeaders, redactString } from './redact.js';
export {
  MAX_CONSOLE_SOURCE_LENGTH,
  MAX_CONSOLE_STACK_LENGTH,
  SANITIZER_REDACTED,
  sanitizeConsoleEntry,
  sanitizeNetworkEntry,
  sanitizeWebSocketEntry,
} from './sanitize.js';
export type {
  LogSanitizer,
  RequestSanitizer,
  ResponseSanitizer,
  SanitizableRequest,
  SanitizableResponse,
  SanitizableWebSocketMessage,
  Sanitizers,
  WebSocketSanitizer,
} from './sanitize.js';
export { cssSelector } from './selector.js';
export {
  SHARED_CAPTURE_KEY,
  SHARED_CAPTURE_LIMITS,
  SHARED_CAPTURE_PROTOCOL,
  SHARED_CAPTURE_WINDOW_MS,
  attachSharedCapture,
} from './shared-capture.js';
export type {
  CaptureListener,
  CaptureRecord,
  CaptureReplayEvent,
  CaptureReplayModule,
  CaptureReplayRecorder,
  CaptureSnapshot,
  SharedCapture,
  SharedCaptureOptions,
} from './shared-capture.js';
export { MAX_ARGUMENT_LENGTH, serializeArgument } from './serialize.js';
export type { SerializeOptions } from './serialize.js';
export { DEFAULT_BUFFER_LIMITS, createRecordingSession } from './session.js';
export type {
  BufferLimits,
  DiagnosticsStream,
  RecordingClock,
  RecordingSession,
  RecordingSessionOptions,
  RecordingState,
  StreamEntries,
} from './session.js';
export {
  DEFAULT_INPUT_DEBOUNCE_MS,
  DEFAULT_USER_EVENT_THROTTLE_MS,
  MAX_MASKED_VALUE_LENGTH,
  MAX_TARGET_TEXT_LENGTH,
  createUserEventCapture,
} from './user-events.js';
export type {
  UserEventCapture,
  UserEventCaptureOptions,
  UserEventCaptureTarget,
} from './user-events.js';
export { VERSION } from './version.js';
export { createWebSocketCapture } from './websocket.js';
export type {
  WebSocketCapture,
  WebSocketCaptureOptions,
  WebSocketCaptureTarget,
} from './websocket.js';
