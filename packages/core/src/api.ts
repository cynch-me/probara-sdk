/**
 * Readable names for the generated types of the operations core calls: `submitReport`
 * (`POST /api/v1/projects/{projectId}/reports`), `closeRun` (`POST /api/v1/runs/{runUlid}/close`),
 * `stageResultAttachments` (`POST /api/v1/runs/{runUlid}/results/{resultUlid}/attachments:stage`)
 * and `commitResultAttachments` (`PATCH /api/v1/runs/{runUlid}/results/{resultUlid}/attachments`).
 * The source of truth is `src/generated/api.ts` (`pnpm --filter @probara/core generate:api`).
 */
import type { paths } from './generated/api.js';

type SubmitReport = paths['/api/v1/projects/{projectId}/reports']['post'];

/** The body of a report. */
export type ReportRequest = NonNullable<SubmitReport['requestBody']>['content']['application/json'];

/** The run a report reuses (`{ ulid, source? }`) or creates (`{ name, ... }`). */
export type ReportRunInput = ReportRequest['run'];

/** One automated result of a report. */
export type ReportResultEntry = ReportRequest['results'][number];

/** `options` of a report: case creation, root suite and whether to close the run. */
export type ReportOptions = NonNullable<ReportRequest['options']>;

/** Outcome of one test: `passed`, `failed`, `skipped` or `blocked`. */
export type ResultStatus = ReportResultEntry['status'];

/** The `201` body of a recorded report. */
export type ReportResponse = SubmitReport['responses'][201]['content']['application/json'];

/** The answer to one entry, at the same index as the request entry. */
export type ReportEntryOutcome = ReportResponse['results'][number];

/** Why an entry recorded nothing. */
export type UnmatchedReason = Extract<ReportEntryOutcome, { outcome: 'unmatched' }>['reason'];

/** The error body every non-2xx response of the API carries. */
export type ApiErrorBody = SubmitReport['responses'][422]['content']['application/json'];

type CloseRun = paths['/api/v1/runs/{runUlid}/close']['post'];

/** The `200` body of `POST /api/v1/runs/{runUlid}/close`: the closed run. */
export type CloseRunResponse = CloseRun['responses'][200]['content']['application/json'];

type StageResultAttachments =
  paths['/api/v1/runs/{runUlid}/results/{resultUlid}/attachments:stage']['post'];

/** The `200` body of a stage request: one staged ref per uploaded file, in upload order. */
export type StageAttachmentsResponse =
  StageResultAttachments['responses'][200]['content']['application/json'];

/** A staged file, not attached to anything yet: commit it to attach it to its result. */
export type StagedAttachment = StageAttachmentsResponse['attachments'][number];

type CommitResultAttachments =
  paths['/api/v1/runs/{runUlid}/results/{resultUlid}/attachments']['patch'];

/** The body of a commit: the whole attachment list of a result, each item with its `position`. */
export type CommitAttachmentsRequest = NonNullable<
  CommitResultAttachments['requestBody']
>['content']['application/json'];

/** One item of a commit: a staged ref plus its `position`, or `{ ulid, position }` to keep one. */
export type CommitAttachmentItem = CommitAttachmentsRequest['attachments'][number];

/** The `200` body of a commit: the committed list. */
export type CommitAttachmentsResponse =
  CommitResultAttachments['responses'][200]['content']['application/json'];

/** An attachment of a result. */
export type CommittedAttachment = CommitAttachmentsResponse['attachments'][number];
