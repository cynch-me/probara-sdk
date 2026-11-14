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
