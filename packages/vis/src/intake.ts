/**
 * The clients of Probara's public intakes, which share one client: the recording link intake,
 * `/api/v1/public/vis-recording/{token}`, and the widget intake of in-app reporting,
 * `/api/v1/public/vis-widget/{widgetKey}`, which serves the same submission routes. Read the link
 * (or the widget's configuration), start a submission, upload the video in parts and the diagnostics streams, finalize or
 * abort. Every request is sent without credentials (no cookie, no `Authorization`), without a
 * referrer and without caching; the tokens travel in the path and never in an error message. Every
 * request names the organizations the page serves in the `probara-organizations` header: the
 * intake serves a page only for a link of one of them.
 * Every request has a time limit, so none can leave the recorder waiting forever.
 */

/** Where the recording link intake lives under the API origin. */
export const INTAKE_PATH = '/api/v1/public/vis-recording/';

/** Where the widget intake of in-app reporting lives under the API origin. */
export const WIDGET_INTAKE_PATH = '/api/v1/public/vis-widget/';

/** The header of the start of a widget submission that carries the reporter token. */
export const REPORTER_HEADER = 'probara-reporter';

/** The longest reporter token sent. */
const MAX_REPORTER_TOKEN_LENGTH = 8192;

export type IntakeFetch = (input: string, init: RequestInit) => Promise<Response>;

/** What both intakes are created with. */
interface ClientOptions {
  /** The origin of the Probara API, such as `https://app.probara.net`; anything after it is ignored. */
  apiOrigin: string;
  /** The ULIDs of the Probara organizations the page serves, sent with every request. */
  organizations: readonly string[];
  fetch?: IntakeFetch;
  /** How long a request may take, answer included, in milliseconds; 30 seconds unless given. */
  timeoutMs?: number;
  /** How long a part or diagnostics upload may take, in milliseconds; 2 minutes unless given. */
  uploadTimeoutMs?: number;
}

export interface IntakeOptions extends ClientOptions {
  /** The recording link token. */
  token: string;
}

/** Gives the token of a verified reporter, or `null` for none. */
export type ReporterTokenProvider = () => string | null | Promise<string | null>;

export interface WidgetIntakeOptions extends ClientOptions {
  /** The widget key. */
  widgetKey: string;
  /**
   * Called once per submission, right before its start; the token goes in the
   * `probara-reporter` header of the start. A throw, a rejection, `null`, anything that is not a
   * token, or no answer within a request's time limit means no header.
   */
  reporterToken?: ReporterTokenProvider;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 120_000;
/**
 * The finalize makes a WebM seekable by rewriting it on the server, which takes longer the larger
 * the video: its time limit grows by this much for every full 8 MiB uploaded.
 */
const FINALIZE_MS_PER_8_MIB = 1_000;
const EIGHT_MIB = 8 * 1024 * 1024;

/** The header that names the organizations the page serves, ULIDs joined by commas. */
export const ORGANIZATIONS_HEADER = 'probara-organizations';

/** The URL parameters of a link, each overriding the link's own value for this recording. */
export interface LinkQuery {
  title?: string;
  reference?: string;
  /** The ULID of a folder that is not private. */
  folder?: string;
  microphone?: boolean;
}

/** The link as the intake shows it before recording. */
export interface RecordingLink {
  organizationName: string;
  title: string;
  reference: string | null;
  folder: { ulid: string; name: string } | null;
  microphone: boolean;
  /** The longest recording the organization's plan allows, in minutes. */
  recordingMaxMinutes: number;
  expiresAt: number | null;
}

/** What a submission starts with: the pending Vis. */
export interface SubmissionStart {
  title?: string;
  reference?: string;
  folderUlid?: string;
  pageUrl?: string;
  pageTitle?: string;
  environment?: object;
  capturedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface UploadSession {
  uploadUlid: string;
  /** The size of every part except the last. */
  partSize: number;
  /** The largest total size the upload may reach. */
  maxBytes: number;
}

export type DiagnosticsKind = 'console' | 'network' | 'events';

/** What a chunked upload holds: the video, or a DOM replay (gzip-compressed NDJSON). */
export type UploadKind = 'video' | 'replay';

export interface Submission {
  readonly visUlid: string;
  /** Opens the chunked upload of the video (unless `kind` says `replay`). */
  createUpload(contentType: string, kind?: UploadKind): Promise<UploadSession>;
  putPart(uploadUlid: string, partNumber: number, part: Blob): Promise<void>;
  complete(uploadUlid: string): Promise<void>;
  /** Uploads a gzip-compressed NDJSON diagnostics stream. */
  putAsset(kind: DiagnosticsKind, gzipped: Uint8Array<ArrayBuffer>): Promise<void>;
  finalize(durationMs: number): Promise<void>;
  /** Abandons the submission: the pending Vis and its media are deleted. */
  abort(options?: { keepalive?: boolean }): Promise<void>;
}

export interface Intake {
  /** The URL prefix of every intake request, to leave out of the network capture. */
  readonly prefix: string;
  readLink(query?: LinkQuery): Promise<RecordingLink>;
  start(body: SubmissionStart): Promise<Submission>;
}

/** The widget's configuration, as the widget intake shows it. */
export interface WidgetConfig {
  organizationName: string;
  /** The longest recording the organization's plan allows, in minutes. */
  recordingMaxMinutes: number;
  /** Whether the widget keeps an instant replay of what just happened. */
  instantReplay: boolean;
  /** Whether a report needs the token of a verified reporter. */
  requireVerifiedReporter: boolean;
}

/** What a widget submission starts with: a link's start, its kind and a description. */
export interface WidgetSubmissionStart extends SubmissionStart {
  kind: 'video' | 'replay';
  /** What happened, in the reporter's words: plain text up to 2,000 characters. */
  description?: string;
}

export interface WidgetIntake {
  /** The URL prefix of every intake request, to leave out of the network capture. */
  readonly prefix: string;
  readConfig(): Promise<WidgetConfig>;
  start(body: WidgetSubmissionStart): Promise<Submission>;
}

/**
 * A refusal or failure of the intake. `status` is `null` when no answer arrived; `code` is the
 * error code of the answer (`not_found`, `too_many_requests`...), `network` when no answer
 * arrived, `timeout` when the request took longer than its time limit (it is cancelled),
 * `invalid_response` when the answer was not the expected shape; `reason` is its
 * `details.reason` (`recording_too_long`...).
 */
export class IntakeError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly reason: string | null;

  constructor(status: number | null, code: string | null, reason: string | null = null) {
    const answered = status === null ? 'did not answer' : `answered ${String(status)}`;
    super(`the recording intake ${answered}${code === null ? '' : ` (${code})`}`);
    this.name = 'IntakeError';
    this.status = status;
    this.code = code;
    this.reason = reason;
  }
}

/**
 * Why the widget intake refused a report, as the panel tells it: no reporter token where the
 * widget requires one, a token it refused, the widget's hourly cap, too many reports of this
 * reporter still open, or too many requests.
 */
export type Refusal =
  'reporter_required' | 'invalid_reporter' | 'hourly_cap' | 'too_many_open' | 'rate_limited';

const RATE_REFUSALS: readonly string[] = ['hourly_cap', 'too_many_open', 'rate_limited'];

/** The `Refusal` of a widget intake error, or `null` for any other failure. */
export function widgetRefusalOf(error: unknown): Refusal | null {
  if (!(error instanceof IntakeError)) return null;
  if (
    error.status === 401 &&
    (error.code === 'reporter_required' || error.code === 'invalid_reporter')
  )
    return error.code;
  if (error.status === 429 && error.reason !== null && RATE_REFUSALS.includes(error.reason))
    return error.reason as Refusal;
  return null;
}

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isPositive = (value: unknown): value is number => isCount(value) && value > 0;
/** A token the intake issued: printable ASCII, sent back in a path. */
const isToken = (value: unknown): value is string =>
  isString(value) && value.length > 0 && value.length <= 448 && /^[\x21-\x7e]+$/.test(value);

function invalid(status: number): IntakeError {
  return new IntakeError(status, 'invalid_response');
}

function parseConfig(body: unknown, status: number): WidgetConfig {
  if (!isFields(body)) throw invalid(status);
  const { organizationName, recordingMaxMinutes, instantReplay, requireVerifiedReporter } = body;
  if (
    !isString(organizationName) ||
    !isCount(recordingMaxMinutes) ||
    typeof instantReplay !== 'boolean' ||
    typeof requireVerifiedReporter !== 'boolean'
  ) {
    throw invalid(status);
  }
  return { organizationName, recordingMaxMinutes, instantReplay, requireVerifiedReporter };
}

function parseLink(body: unknown, status: number): RecordingLink {
  if (!isFields(body)) throw invalid(status);
  const { organizationName, title, reference, folder, microphone, recordingMaxMinutes, expiresAt } =
    body;
  if (
    !isString(organizationName) ||
    !isString(title) ||
    !(reference === null || isString(reference)) ||
    typeof microphone !== 'boolean' ||
    !isCount(recordingMaxMinutes) ||
    !(expiresAt === null || isCount(expiresAt))
  ) {
    throw invalid(status);
  }
  let resolvedFolder: RecordingLink['folder'] = null;
  if (folder !== null) {
    if (!isFields(folder) || !isString(folder['ulid']) || !isString(folder['name']))
      throw invalid(status);
    resolvedFolder = { ulid: folder['ulid'], name: folder['name'] };
  }
  return {
    organizationName,
    title,
    reference,
    folder: resolvedFolder,
    microphone,
    recordingMaxMinutes,
    expiresAt,
  };
}

const SAFE: RequestInit = {
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  cache: 'no-store',
  redirect: 'error',
  mode: 'cors',
};

/** The requests of one intake, under its path and token, and the submissions it starts. */
interface Client {
  readonly prefix: string;
  request(
    method: string,
    path: string,
    init?: RequestInput,
  ): Promise<{ status: number; body: unknown }>;
  /** Starts a submission with `body`, sending `headers` with the start only. */
  start(body: object, headers?: Record<string, string>): Promise<Submission>;
}

interface RequestInput {
  body?: BodyInit;
  headers?: Record<string, string>;
  keepalive?: boolean;
  /** A part or diagnostics upload, which gets the longer time limit. */
  upload?: boolean;
  /** A time limit of its own, instead of the one its kind gets. */
  timeoutMs?: number;
}

function createClient(options: ClientOptions, path: string, token: string): Client {
  const url = new URL(options.apiOrigin);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError('the API origin must be an http or https URL');
  }
  // The page's fetch as it is now, before any capture wraps it.
  const send: IntakeFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const prefix = `${url.origin}${path}`;
  const linkUrl = `${prefix}${encodeURIComponent(token)}`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const uploadTimeoutMs = options.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
  const organizations = options.organizations.join(',');

  /** One request within its time limit: past it, the request is cancelled and fails. */
  async function request(
    method: string,
    path: string,
    init: RequestInput = {},
  ): Promise<{ status: number; body: unknown }> {
    const cancel = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => {
          cancel.abort();
          reject(new IntakeError(null, 'timeout'));
        },
        init.timeoutMs ?? (init.upload === true ? uploadTimeoutMs : timeoutMs),
      );
    });
    try {
      return await Promise.race([exchange(method, path, init, cancel.signal), expired]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function exchange(
    method: string,
    path: string,
    init: RequestInput,
    signal: AbortSignal,
  ): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      const sent: RequestInit = { ...SAFE, method, signal };
      if (init.body !== undefined) sent.body = init.body;
      sent.headers = { ...init.headers, [ORGANIZATIONS_HEADER]: organizations };
      if (init.keepalive === true) sent.keepalive = true;
      response = await send(`${linkUrl}${path}`, sent);
    } catch {
      throw new IntakeError(null, 'network');
    }
    let body: unknown = null;
    try {
      if (response.status !== 204) body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const error = isFields(body) && isFields(body['error']) ? body['error'] : {};
      const details = isFields(error['details']) ? error['details'] : {};
      throw new IntakeError(
        response.status,
        isString(error['code']) ? error['code'] : null,
        isString(details['reason']) ? details['reason'] : null,
      );
    }
    return { status: response.status, body };
  }

  const json = (value: unknown) => ({
    body: JSON.stringify(value),
    headers: { 'content-type': 'application/json' },
  });

  function submission(visUlid: string, submissionToken: string): Submission {
    const base = `/submissions/${encodeURIComponent(submissionToken)}`;
    let uploadedBytes = 0;
    return {
      visUlid,
      async createUpload(contentType, kind = 'video') {
        const { status, body } = await request(
          'POST',
          `${base}/uploads`,
          // A replay is gzip-compressed NDJSON, and says so.
          json(
            kind === 'replay'
              ? { kind, contentType, contentEncoding: 'gzip' }
              : { kind: 'video', contentType },
          ),
        );
        if (
          !isFields(body) ||
          !isString(body['uploadUlid']) ||
          !isPositive(body['partSize']) ||
          !isPositive(body['maxBytes'])
        ) {
          throw invalid(status);
        }
        return {
          uploadUlid: body['uploadUlid'],
          partSize: body['partSize'],
          maxBytes: body['maxBytes'],
        };
      },
      async putPart(uploadUlid, partNumber, part) {
        await request(
          'PUT',
          `${base}/uploads/${encodeURIComponent(uploadUlid)}/parts/${String(partNumber)}`,
          { body: part, upload: true },
        );
        uploadedBytes += part.size;
      },
      async complete(uploadUlid) {
        await request('POST', `${base}/uploads/${encodeURIComponent(uploadUlid)}/complete`);
      },
      async putAsset(kind, gzipped) {
        await request('PUT', `${base}/assets/${kind}`, {
          body: gzipped,
          headers: { 'content-type': 'application/x-ndjson', 'content-encoding': 'gzip' },
          upload: true,
        });
      },
      async finalize(durationMs) {
        await request('POST', `${base}/finalize`, {
          ...json({ durationMs }),
          timeoutMs: timeoutMs + Math.floor(uploadedBytes / EIGHT_MIB) * FINALIZE_MS_PER_8_MIB,
        });
      },
      async abort(abortOptions = {}) {
        await request('DELETE', base, abortOptions.keepalive === true ? { keepalive: true } : {});
      },
    };
  }

  return {
    prefix,
    request,
    async start(body, headers = {}) {
      const start = json(body);
      const answer = await request('POST', '/submissions', {
        ...start,
        headers: { ...start.headers, ...headers },
      });
      const fields = answer.body;
      if (
        !isFields(fields) ||
        !isString(fields['visUlid']) ||
        !isToken(fields['submissionToken'])
      ) {
        throw invalid(answer.status);
      }
      return submission(fields['visUlid'], fields['submissionToken']);
    },
  };
}

/** The client of a recording link's intake. */
export function createIntake(options: IntakeOptions): Intake {
  const client = createClient(options, INTAKE_PATH, options.token);
  return {
    prefix: client.prefix,
    async readLink(query = {}) {
      const params = new URLSearchParams();
      if (query.title !== undefined) params.set('title', query.title);
      if (query.reference !== undefined) params.set('reference', query.reference);
      if (query.folder !== undefined) params.set('folder', query.folder);
      if (query.microphone !== undefined) params.set('microphone', String(query.microphone));
      const search = params.size === 0 ? '' : `?${params.toString()}`;
      const { status, body } = await client.request('GET', search);
      return parseLink(body, status);
    },
    start: (body) => client.start(body),
  };
}

/**
 * The reporter token `provide` gives, or `null` when it throws, rejects, gives anything but a
 * token, or takes longer than `timeoutMs`.
 */
async function reporterTokenOf(
  provide: ReporterTokenProvider | undefined,
  timeoutMs: number,
): Promise<string | null> {
  if (provide === undefined) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const given: unknown = await Promise.race([
      Promise.resolve().then(provide),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
        }, timeoutMs);
      }),
    ]);
    // A JWS fits a header: printable ASCII, and never larger than a header may reasonably be.
    return isString(given) &&
      given.length <= MAX_REPORTER_TOKEN_LENGTH &&
      /^[\x21-\x7e]+$/.test(given)
      ? given
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The client of a widget's intake: in-app reporting. */
export function createWidgetIntake(options: WidgetIntakeOptions): WidgetIntake {
  const client = createClient(options, WIDGET_INTAKE_PATH, options.widgetKey);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    prefix: client.prefix,
    async readConfig() {
      const { status, body } = await client.request('GET', '');
      return parseConfig(body, status);
    },
    async start(body) {
      const token = await reporterTokenOf(options.reporterToken, timeoutMs);
      return client.start(body, token === null ? {} : { [REPORTER_HEADER]: token });
    },
  };
}
