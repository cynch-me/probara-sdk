/**
 * Readable names for the generated types of the operations core calls: `submitReport`
 * (`POST /api/v1/projects/{projectId}/reports`), `createRun`
 * (`POST /api/v1/projects/{projectId}/runs`), `closeRun` (`POST /api/v1/runs/{runUlid}/close`),
 * `stageResultAttachments` (`POST /api/v1/runs/{runUlid}/results/{resultUlid}/attachments:stage`),
 * `commitResultAttachments` (`PATCH /api/v1/runs/{runUlid}/results/{resultUlid}/attachments`),
 * `listRunCaseKeys` (`GET /api/v1/runs/{runUlid}/case-keys`) and the Probara Snap ingest
 * (`/api/v1/projects/{projectId}/snap/builds`...).
 * The source of truth is `src/generated/api.ts` (`pnpm --filter @probara/core generate:api`).
 */
import type { paths } from './generated/api.js';

type SubmitReport = paths['/api/v1/projects/{projectId}/reports']['post'];

type GeneratedReportRequest = NonNullable<
  SubmitReport['requestBody']
>['content']['application/json'];

/**
 * One automated result of a report. `contextParameters` names the entries of `parameters` that are
 * reporter context: shown on the result, never a parameter of a case the report creates. It is absent
 * when there are none. Hand-typed: the generated spec predates it.
 */
export type ReportResultEntry = GeneratedReportRequest['results'][number] & {
  contextParameters?: string[];
};

/** The body of a report. */
export type ReportRequest = Omit<GeneratedReportRequest, 'results'> & {
  results: ReportResultEntry[];
};

/** The run a report reuses (`{ ulid, source? }`) or creates (`{ name, ... }`). */
export type ReportRunInput = ReportRequest['run'];

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

type CreateRun = paths['/api/v1/projects/{projectId}/runs']['post'];

/** The body of `POST /api/v1/projects/{projectId}/runs`: the run to create. */
export type CreateRunRequest = NonNullable<CreateRun['requestBody']>['content']['application/json'];

/** The `201` body of `POST /api/v1/projects/{projectId}/runs`: the created run. */
export type CreateRunResponse = CreateRun['responses'][201]['content']['application/json'];

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

type ListRunCaseKeys = paths['/api/v1/runs/{runUlid}/case-keys']['get'];

type RunCaseKeysBody = ListRunCaseKeys['responses'][200]['content']['application/json'];

/**
 * A case of a run as the server lists it: its parameters by name and value, an empty list when it
 * declares none.
 */
export type RunCaseKeyItem = RunCaseKeysBody['items'][number];

/**
 * A case of a run: its display id, its automation key (`null` when it has none), and the parameters
 * it declares (`{ browser: 'chromium' }`), left out when it declares none.
 */
export type RunCaseKey = Omit<RunCaseKeyItem, 'parameters'> & {
  parameters?: Readonly<Record<string, string>>;
};

/** The `200` body of `GET /api/v1/runs/{runUlid}/case-keys`: one page, and the cursor of the next. */
export type RunCaseKeysPage = RunCaseKeysBody;

type GherkinSync = paths['/api/v1/projects/{projectId}/gherkin-sync']['post'];

/** The body of `POST /api/v1/projects/{projectId}/gherkin-sync`: the scenarios a CI job parsed. */
export type GherkinSyncRequest = NonNullable<
  GherkinSync['requestBody']
>['content']['application/json'];

/** One `.feature` file of a sync: its scenarios, under the feature suite. */
export type GherkinSyncFeature = GherkinSyncRequest['features'][number];

/** One scenario of a sync, with the automation key the client built for it. */
export type GherkinSyncScenario = GherkinSyncFeature['scenarios'][number];

/** One step of a scenario, its Background, or a Data Table or Doc String argument. */
export type GherkinSyncStep = GherkinSyncScenario['steps'][number];

/** The `200` body of a sync: the counts, and the action of each scenario and archived case. */
export type GherkinSyncResponse = GherkinSync['responses'][200]['content']['application/json'];

/** What a sync did to one case: created, updated, moved, restored, archived or unchanged. */
export type GherkinSyncCaseOutcome = GherkinSyncResponse['cases'][number];

/** A Gherkin step keyword: `Given`, `When`, `Then`, `And`, `But` or `*`, as a report step carries it. */
export type StepKeyword = NonNullable<NonNullable<ReportResultEntry['steps']>[number]['keyword']>;

type SnapBuilds = '/api/v1/projects/{projectId}/snap/builds';

type CreateSnapBuild = paths[SnapBuilds]['post'];

/** The body of `POST /api/v1/projects/{projectId}/snap/builds`: the build and its declared files. */
export type CreateSnapBuildRequest = NonNullable<
  CreateSnapBuild['requestBody']
>['content']['application/json'];

/** The `201` body of a build creation: the build, the shard to finalize and the files to upload. */
export type CreateSnapBuildResponse =
  CreateSnapBuild['responses'][201]['content']['application/json'];

/** A Probara Snap build; `url` is its page in Probara. */
export type SnapBuild = CreateSnapBuildResponse['build'];

type UploadSnapFile = paths[`${SnapBuilds}/{buildUlid}/files/{sha256}`]['put'];

/** The `200` body of a Snap file upload; `stored` is `false` when Probara already held the digest. */
export type UploadSnapFileResponse =
  UploadSnapFile['responses'][200]['content']['application/json'];

type FinalizeSnapShard = paths[`${SnapBuilds}/{buildUlid}/shards/{shardUlid}:finalize`]['post'];

/** The body of a shard finalize: the screenshots of the shard, each naming an uploaded file. */
export type FinalizeSnapShardRequest = NonNullable<
  FinalizeSnapShard['requestBody']
>['content']['application/json'];

/** The body of `POST .../snap/builds:finalize`: the nonce of the build, and its name when not `default`. */
export type FinalizeSnapBuildByNonceRequest = NonNullable<
  paths[`${SnapBuilds}:finalize`]['post']['requestBody']
>['content']['application/json'];

/** One screenshot of a shard: its identity, its file and the test that took it. */
export type SnapScreenshotEntry = FinalizeSnapShardRequest['screenshots'][number];

/** The test a Snap screenshot was taken in. */
export type SnapScreenshotTest = NonNullable<SnapScreenshotEntry['test']>;

type ListSnapBuilds = paths[SnapBuilds]['get'];

/** The filters of `GET /api/v1/projects/{projectId}/snap/builds`, which answers the newest build first. */
export type ListSnapBuildsQuery = NonNullable<ListSnapBuilds['parameters']['query']>;

/** A page of Snap builds, each with the `ciNonce` it was created with. */
export type SnapBuildPage = ListSnapBuilds['responses'][200]['content']['application/json'];
