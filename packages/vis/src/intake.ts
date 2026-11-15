/**
 * The client of Probara's public recording intake, `/api/v1/public/vis-recording/{token}`: read
 * the link, start a submission, upload the video in parts and the diagnostics streams, finalize or
 * abort. Every request is sent without credentials (no cookie, no `Authorization`), without a
 * referrer and without caching; the tokens travel in the path and never in an error message.
 * Every request has a time limit, so none can leave the recorder waiting forever.
 */

/** Where the intake lives under the API origin. */
export const INTAKE_PATH = '/api/v1/public/vis-recording/';

export type IntakeFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface IntakeOptions {
  /** The origin of the Probara API, such as `https://app.probara.net`; anything after it is ignored. */
  apiOrigin: string;
  /** The recording link token. */
  token: string;
  fetch?: IntakeFetch;
  /** How long a request may take, answer included, in milliseconds; 30 seconds unless given. */
  timeoutMs?: number;
  /** How long a part or diagnostics upload may take, in milliseconds; 2 minutes unless given. */
  uploadTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 120_000;
/**
 * The finalize makes a WebM seekable by rewriting it on the server, which takes longer the larger
 * the video: its time limit grows by this much for every full 8 MiB uploaded.
 */
const FINALIZE_MS_PER_8_MIB = 1_000;
const EIGHT_MIB = 8 * 1024 * 1024;

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

export interface Submission {
  readonly visUlid: string;
  createUpload(contentType: string): Promise<UploadSession>;
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

export function createIntake(options: IntakeOptions): Intake {
  const url = new URL(options.apiOrigin);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError('the API origin must be an http or https URL');
  }
  // The page's fetch as it is now, before any capture wraps it.
  const send: IntakeFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const prefix = `${url.origin}${INTAKE_PATH}`;
  const linkUrl = `${prefix}${encodeURIComponent(options.token)}`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const uploadTimeoutMs = options.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;

  interface RequestInput {
    body?: BodyInit;
    headers?: Record<string, string>;
    keepalive?: boolean;
    /** A part or diagnostics upload, which gets the longer time limit. */
    upload?: boolean;
    /** A time limit of its own, instead of the one its kind gets. */
    timeoutMs?: number;
  }

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
      if (init.headers !== undefined) sent.headers = init.headers;
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
      async createUpload(contentType) {
        const { status, body } = await request(
          'POST',
          `${base}/uploads`,
          json({ kind: 'video', contentType }),
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
    async readLink(query = {}) {
      const params = new URLSearchParams();
      if (query.title !== undefined) params.set('title', query.title);
      if (query.reference !== undefined) params.set('reference', query.reference);
      if (query.folder !== undefined) params.set('folder', query.folder);
      if (query.microphone !== undefined) params.set('microphone', String(query.microphone));
      const search = params.size === 0 ? '' : `?${params.toString()}`;
      const { status, body } = await request('GET', search);
      return parseLink(body, status);
    },
    async start(body) {
      const answer = await request('POST', '/submissions', json(body));
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
