/**
 * Probara Vis over the public API (`/api/v1/vises`): the shapes core sends and reads, typed by hand
 * from the published contract (the generated API types predate Vis), and the checks a success body
 * must pass. A Vis belongs to the organization, not to a project, and is shown as `VIS-<n>`.
 */

/** What a Vis captured. */
export const VIS_KINDS = ['video', 'screenshot', 'replay'] as const;
export type VisKind = (typeof VIS_KINDS)[number];

/** Where a Vis was made: `cli` for this toolkit. */
export const VIS_SOURCES = ['extension', 'recording_link', 'sdk', 'upload', 'cli'] as const;
export type VisSource = (typeof VIS_SOURCES)[number];

/** `pending` until its media is finalized, then `ready`; `failed` when it could not be. */
export const VIS_STATUSES = ['pending', 'ready', 'failed'] as const;
export type VisStatus = (typeof VIS_STATUSES)[number];

/** `public` to every member of the organization, or `private`. */
export const VIS_ACCESS_MODES = ['public', 'private'] as const;
export type VisAccessMode = (typeof VIS_ACCESS_MODES)[number];

/** Every stored object a Vis may hold, at most one of each. */
export type VisAssetKind =
  | 'video'
  | 'screenshot'
  | 'screenshot_full_page'
  | 'thumbnail'
  | 'replay'
  | 'console'
  | 'network'
  | 'events';

/** The size of every part of a chunked upload except the last, which may be smaller (8 MiB). */
export const VIS_UPLOAD_PART_BYTES = 8 * 1024 * 1024;

/** A Vis, as the API answers it. */
export interface Vis {
  ulid: string;
  visNumber: number;
  /** `VIS-<n>`, unique inside the organization. */
  displayId: string;
  title: string;
  description: string | null;
  kind: VisKind;
  source: VisSource;
  status: VisStatus;
  pageUrl: string | null;
  pageTitle: string | null;
  environment: Record<string, unknown>;
  durationMs: number | null;
  capturedAt: number | null;
  metadata: Record<string, unknown> | null;
  creatorUlid: string | null;
  folderUlid: string | null;
  accessMode: VisAccessMode;
  linkSharing: 'members' | 'anyone';
  canEdit: boolean;
  createdAt: number;
  updatedAt: number;
}

/** One page of `GET /api/v1/vises`, newest Vis first. */
export interface VisPage {
  items: Vis[];
  page: number;
  pageSize: number;
  total: number;
}

/** The filters and the page of `GET /api/v1/vises`. Without `status`, only `ready` Vises. */
export interface ListVisesQuery {
  page?: number;
  pageSize?: number;
  kind?: VisKind;
  source?: VisSource;
  /** A member's user ULID. */
  creator?: string;
  status?: VisStatus;
  /** Text in the title, ignoring case. */
  q?: string;
  /** A folder ULID, or `none` for the Vises in no folder. */
  folder?: string;
}

/** The body of `POST /api/v1/vises`: a new `pending` Vis. */
export interface CreateVisRequest {
  title: string;
  kind: VisKind;
  source: VisSource;
  description?: string;
  pageUrl?: string;
  pageTitle?: string;
  environment?: Record<string, unknown>;
  /** Refused for a screenshot. */
  durationMs?: number;
  capturedAt?: number;
  folderUlid?: string;
  accessMode?: VisAccessMode;
  /** At most 10 KB once serialized. */
  metadata?: Record<string, unknown>;
}

/** The body of `PATCH /api/v1/vises/{visUlid}`: at least one field. `null` clears or unfiles. */
export interface UpdateVisRequest {
  title?: string;
  description?: string | null;
  folderUlid?: string | null;
}

/** Who sees a Vis (`GET`/`PATCH /api/v1/vises/{visUlid}/access`). */
export interface VisAccess {
  mode: VisAccessMode;
  creatorUlid: string | null;
  grantedCount: number;
  revokedCount: number;
}

/** A stored asset of a Vis, without its bytes. */
export interface VisAsset {
  kind: VisAssetKind;
  contentType: string;
  contentEncoding: 'gzip' | null;
  byteSize: number;
  uploaderUlid: string | null;
  createdAt: number;
  updatedAt: number;
}

/** The body of `POST /api/v1/vises/{visUlid}/uploads`: a chunked upload of a video or a replay. */
export interface StartVisUploadRequest {
  kind: 'video' | 'replay';
  contentType: string;
  /** Required for a replay. */
  contentEncoding?: 'gzip';
  /** The total size, checked against the free storage before any part is sent. */
  byteSize?: number;
}

/** An open chunked upload. */
export interface VisUploadSession {
  uploadUlid: string;
  kind: 'video' | 'replay';
  contentType: string;
  contentEncoding: 'gzip' | null;
  /** The size of every part except the last. */
  partSize: number;
  maxBytes: number;
  receivedParts: { partNumber: number; byteSize: number }[];
  createdAt: number;
}

/** The answer to one part. */
export interface VisUploadPart {
  uploadUlid: string;
  partNumber: number;
  byteSize: number;
}

/** The body of `POST /api/v1/vises/{visUlid}/finalize`. */
export interface FinalizeVisRequest {
  /** The length of a video or a replay; refused for a screenshot. */
  durationMs?: number;
}

/** `reusable`: any number of recordings; `one_time`: the first recording takes it. */
export const VIS_RECORDING_LINK_MODES = ['reusable', 'one_time'] as const;
export type VisRecordingLinkMode = (typeof VIS_RECORDING_LINK_MODES)[number];

/** `active` until revoked; a revoked link never works again. */
export const VIS_RECORDING_LINK_STATUSES = ['active', 'revoked'] as const;
export type VisRecordingLinkStatus = (typeof VIS_RECORDING_LINK_STATUSES)[number];

/**
 * A recording link (`/api/v1/vis-recording-links`): a URL anyone records their screen with, no
 * account needed; what they record arrives as a Vis of the organization.
 */
export interface VisRecordingLink {
  ulid: string;
  /** The default title of the Vises it receives. */
  title: string;
  /** The folder its Vises go into. */
  folderUlid: string | null;
  /** Kept on every Vis it receives, such as a ticket number. */
  reference: string | null;
  mode: VisRecordingLinkMode;
  /** Epoch milliseconds; `null` for never. */
  expiresAt: number | null;
  /** Whether the recorder starts with the microphone on. */
  microphone: boolean;
  status: VisRecordingLinkStatus;
  /** The URL to send, `/record/{token}`; `null` once the link is revoked. */
  url: string | null;
  creatorUlid: string | null;
  /** Recordings it received. */
  submissionCount: number;
  lastSubmissionAt: number | null;
  /** Whether the caller may change, revoke and delete it. */
  canEdit: boolean;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** One page of `GET /api/v1/vis-recording-links`, newest link first. */
export interface VisRecordingLinkPage {
  items: VisRecordingLink[];
  page: number;
  pageSize: number;
  total: number;
}

/** The filter and the page of `GET /api/v1/vis-recording-links`. Without `status`, every link. */
export interface ListVisRecordingLinksQuery {
  page?: number;
  pageSize?: number;
  status?: VisRecordingLinkStatus;
}

/** The body of `POST /api/v1/vis-recording-links`. */
export interface CreateVisRecordingLinkRequest {
  title: string;
  /** A folder that is not private. */
  folderUlid?: string | null;
  /** At most 200 characters. */
  reference?: string | null;
  /** `reusable` when omitted. */
  mode?: VisRecordingLinkMode;
  expiresAt?: number | null;
  /** `false` when omitted. */
  microphone?: boolean;
}

/** The body of `PATCH /api/v1/vis-recording-links/{linkUlid}`: at least one field. `null` clears. */
export interface UpdateVisRecordingLinkRequest {
  title?: string;
  folderUlid?: string | null;
  reference?: string | null;
  expiresAt?: number | null;
  microphone?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

/** Whether `value` is a Vis: its identity, title, kind and status. */
export function isVis(value: unknown): value is Vis {
  if (!isRecord(value)) return false;
  const { ulid, displayId, title, kind, status } = value;
  return (
    typeof ulid === 'string' &&
    typeof displayId === 'string' &&
    typeof title === 'string' &&
    typeof kind === 'string' &&
    typeof status === 'string'
  );
}

export function isVisPage(value: unknown): value is VisPage {
  if (!isRecord(value)) return false;
  const { items, page, pageSize, total } = value;
  return (
    Array.isArray(items) &&
    items.every(isVis) &&
    isPositiveInteger(page) &&
    isPositiveInteger(pageSize) &&
    Number.isInteger(total)
  );
}

export function isVisAccess(value: unknown): value is VisAccess {
  return isRecord(value) && (value.mode === 'public' || value.mode === 'private');
}

export function isVisAsset(value: unknown): value is VisAsset {
  return isRecord(value) && typeof value.kind === 'string' && Number.isInteger(value.byteSize);
}

export function isVisUploadSession(value: unknown): value is VisUploadSession {
  return (
    isRecord(value) &&
    typeof value.uploadUlid === 'string' &&
    isPositiveInteger(value.partSize) &&
    isPositiveInteger(value.maxBytes)
  );
}

export function isVisUploadPart(value: unknown): value is VisUploadPart {
  return (
    isRecord(value) && typeof value.uploadUlid === 'string' && isPositiveInteger(value.partNumber)
  );
}

/** Whether `value` is a recording link: its identity, title, mode, status and URL. */
export function isVisRecordingLink(value: unknown): value is VisRecordingLink {
  if (!isRecord(value)) return false;
  const { ulid, title, mode, status, url } = value;
  return (
    typeof ulid === 'string' &&
    typeof title === 'string' &&
    VIS_RECORDING_LINK_MODES.includes(mode as VisRecordingLinkMode) &&
    VIS_RECORDING_LINK_STATUSES.includes(status as VisRecordingLinkStatus) &&
    (typeof url === 'string' || url === null)
  );
}

export function isVisRecordingLinkPage(value: unknown): value is VisRecordingLinkPage {
  if (!isRecord(value)) return false;
  const { items, page, pageSize, total } = value;
  return (
    Array.isArray(items) &&
    items.every(isVisRecordingLink) &&
    isPositiveInteger(page) &&
    isPositiveInteger(pageSize) &&
    Number.isInteger(total)
  );
}
