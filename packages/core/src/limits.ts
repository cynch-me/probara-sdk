/**
 * Limits of `POST /api/v1/projects/{projectId}/reports` and of the result attachment operations
 * (`stageResultAttachments`, `commitResultAttachments`). One out-of-contract field rejects the
 * whole request with 422, so core keeps every entry within them.
 *
 * Each value the published OpenAPI expresses is checked against `openapi/probara-api.json` by
 * `limits.test.ts`. Rules the OpenAPI does not express (server refinements, stated in prose) are
 * documented next to the related limit, with their source: the report schema of the Probara
 * server (cynch-tcms `packages/shared/src/api/reports.ts`, `runs.ts`, `test-cases.ts` and
 * `idempotency.ts`).
 */

/** Entries per report (`results`: 1..500). Larger suites are sent as several reports. */
export const MAX_RESULTS_PER_REPORT = 500;

/**
 * Automation key length, after trimming (1..1024). Not in the OpenAPI: the server rejects C0
 * control characters and DEL (`[\u0000-\u001f\u007f]`) in a key.
 */
export const MAX_AUTOMATION_KEY_LENGTH = 1024;

/** Title of a case the report creates, after trimming (1..400). */
export const MAX_TITLE_LENGTH = 400;

/** Suite levels a created case may be placed under (`suitePath`: at most 10). */
export const MAX_SUITE_PATH_DEPTH = 10;

/** One `suitePath` segment, after trimming (1..255). */
export const MAX_SUITE_SEGMENT_LENGTH = 255;

/** Result notes (at most 4000). */
export const MAX_NOTES_LENGTH = 4000;

/** Explicit case link such as `PRB-12`, after trimming (1..64). */
export const MAX_CASE_DISPLAY_ID_LENGTH = 64;

/**
 * Parameters of one result (`parameters`: at most 20). Not in the OpenAPI schema (in its
 * description): names are trimmed, and two names equal once trimmed, or `__proto__`, refuse the
 * whole report with 422.
 */
export const MAX_PARAMETERS = 20;

/** One parameter name, after trimming (1..100), stated in the description only. */
export const MAX_PARAMETER_NAME_LENGTH = 100;

/** One parameter value, after trimming (at most 500). */
export const MAX_PARAMETER_VALUE_LENGTH = 500;

/** Steps of one result, counted across every level of the tree (`steps`: at most 200). */
export const MAX_STEPS_PER_RESULT = 200;

/** Levels of a result's step tree; a top-level step is level 1. Stated in the description only. */
export const MAX_STEP_DEPTH = 10;

/** The action of a result step or a case step, after trimming (1..2000). */
export const MAX_STEP_ACTION_LENGTH = 2000;

/** The expected result and the data of a result step or a case step (at most 2000 each). */
export const MAX_STEP_TEXT_LENGTH = 2000;

/** The error of a result step (at most 4000). */
export const MAX_STEP_ERROR_LENGTH = 4000;

/** Description of a case the report creates (`case.description`: at most 4000). */
export const MAX_CASE_DESCRIPTION_LENGTH = 4000;

/** Tags of a case the report creates (`case.tags`: at most 50). */
export const MAX_CASE_TAGS = 50;

/** One case tag, after trimming (1..80). */
export const MAX_CASE_TAG_LENGTH = 80;

/**
 * Fields of a case the report creates (`case.fields`: at most 50). Not in the OpenAPI schema (in
 * its description): two names equal once trimmed and compared ignoring case, or `__proto__`,
 * refuse the whole report with 422. A field or value the server cannot resolve is skipped with a
 * warning instead.
 */
export const MAX_CASE_FIELDS = 50;

/** One case field name, after trimming (1..200), stated in the description only. */
export const MAX_CASE_FIELD_NAME_LENGTH = 200;

/** One case field value (at most 4000). */
export const MAX_CASE_FIELD_VALUE_LENGTH = 4000;

/** Steps of a case the report creates (`case.steps`: at most 500). */
export const MAX_CASE_STEPS = 500;

/** Links of one result (`links`: at most 20). */
export const MAX_LINKS_PER_RESULT = 20;

/** The URL of a link, after trimming: an absolute `http:` or `https:` URL of at most 2048. */
export const MAX_LINK_URL_LENGTH = 2048;

/** The name of a link, after trimming (1..255). */
export const MAX_LINK_NAME_LENGTH = 255;

/**
 * Result steps of one report, every level of every entry counted (10000), stated in the
 * description of `results` only: a report over it is refused with 422, so core sends smaller ones.
 */
export const MAX_RESULT_STEPS_PER_REPORT = 10_000;

/** Case steps of one report, every entry counted, whether it creates its case or not (10000). */
export const MAX_CASE_STEPS_PER_REPORT = 10_000;

/** Case tags of one report, every entry counted, whether it creates its case or not (1000). */
export const MAX_CASE_TAGS_PER_REPORT = 1000;

/** Name of a run the report creates, after trimming (1..200). */
export const MAX_RUN_NAME_LENGTH = 200;

/** Tags of a created run (at most 50). */
export const MAX_TAGS = 50;

/** One run tag (1..80). */
export const MAX_TAG_LENGTH = 80;

/** Configuration ULIDs of a created run (at most 20). */
export const MAX_CONFIGURATION_ULIDS = 20;

/** Description of a run the report creates (at most 2000). */
export const MAX_RUN_DESCRIPTION_LENGTH = 2000;

/** Environment of a new run by name (`environment`: at most 80). */
export const MAX_ENVIRONMENT_NAME_LENGTH = 80;

/** Milestone of a new run by display id (`M-3`) or name, after trimming (1..255). */
export const MAX_MILESTONE_REFERENCE_LENGTH = 255;

/** Test plan of a new run by display id (`PLAN-2`) or name, after trimming (1..200). */
export const MAX_PLAN_REFERENCE_LENGTH = 200;

/**
 * Configurations of a new run by name (`configurations`: at most 20 `{ group, name }` pairs). Not
 * in the OpenAPI schema (in its description): a group named twice refuses the request with 422.
 */
export const MAX_CONFIGURATIONS = 20;

/** A configuration group or value name, after trimming (1..120). */
export const MAX_CONFIGURATION_NAME_LENGTH = 120;

/**
 * CI source branch, after trimming (1..255). Not in the OpenAPI: the server rejects C0 and C1
 * control characters and DEL (`[\u0000-\u001f\u007f-\u009f]`) in a branch.
 */
export const MAX_BRANCH_LENGTH = 255;

/** CI source commit (1..64 characters of {@link COMMIT_PATTERN}). */
export const MAX_COMMIT_LENGTH = 64;

/** A commit is visible ASCII only: a hash or a VCS revision id never holds a space. */
export const COMMIT_PATTERN = /^[\x21-\x7E]+$/;

/**
 * CI build URL (at most 2048, `format: uri`). Not in the OpenAPI: the server accepts `http:` and
 * `https:` URLs only, so the web app can render it as a link.
 */
export const MAX_BUILD_URL_LENGTH = 2048;

/** Crockford base32 ULID (runs, environments, milestones, configurations, suites). */
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * `Idempotency-Key` header length (1..255). Not in the OpenAPI schema (only in its description):
 * the server answers 400 unless the key is 1..255 visible ASCII characters.
 */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/** A valid `Idempotency-Key`: 1..{@link MAX_IDEMPOTENCY_KEY_LENGTH} visible ASCII characters. */
export const IDEMPOTENCY_KEY_PATTERN = new RegExp(
  `^[\\x21-\\x7E]{1,${MAX_IDEMPOTENCY_KEY_LENGTH}}$`,
);

/** `file` parts of one `stageResultAttachments` request (1..20). */
export const MAX_ATTACHMENTS_PER_STAGE_REQUEST = 20;

/**
 * Bytes of one attachment (32 MiB), stated in the description of `stageResultAttachments` only.
 * The server also refuses an empty file and executables or scripts, by declared content type.
 */
export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;

/**
 * Attachments of one result (20), stated in the description of `commitResultAttachments` only. A
 * commit replaces the whole list, so it may hold at most this many items.
 */
export const MAX_ATTACHMENTS_PER_RESULT = 20;

/**
 * Declared content types the server refuses (executables and scripts), stated in the description
 * of `stageResultAttachments` only. One refused part fails its whole stage request with 422, so
 * core skips such a file before uploading.
 */
export const DENIED_ATTACHMENT_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-sh',
  'application/x-bat',
  'application/x-msi',
  'application/x-executable',
  'application/vnd.microsoft.portable-executable',
]);

/**
 * Declared content types the server treats as images: it converts them to WebP with a thumbnail
 * (`disposition: inline`) and holds them to {@link MAX_IMAGE_ATTACHMENT_BYTES} and
 * {@link MAX_IMAGE_ATTACHMENT_DIMENSION}. Not in the OpenAPI: the server compares the part's
 * declared type exactly (cynch-tcms `packages/shared/src/attachments/constants.ts`,
 * `RESULT_ATTACHMENT_INLINE_SAFE_MIME_TYPES`); every other type is stored as a plain file.
 */
export const IMAGE_ATTACHMENT_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

/**
 * Bytes of one image attachment (10 MiB), stated in the stage operation's description: the server
 * refuses a larger image, failing its whole stage request with 422, so core skips it before
 * uploading.
 */
export const MAX_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Width and height of one image attachment, read from its header (8192 px per side), stated in the
 * stage operation's description: the server refuses a larger image (a decompression-bomb guard),
 * failing its whole stage request with 422. A full-page screenshot of a long page easily exceeds
 * it, so core skips such an image before uploading.
 */
export const MAX_IMAGE_ATTACHMENT_DIMENSION = 8192;

/** Stored file name of an attachment (`originalFilename`: 1..255). */
export const MAX_ATTACHMENT_FILENAME_LENGTH = 255;

/**
 * File bytes core puts in one stage request (64 MiB). Not a contract limit: 20 files of 32 MiB
 * would exceed the request body limit of the server's platform (100 MB on most Cloudflare Workers
 * plans), so core splits stage requests by total bytes as well as by count.
 */
export const MAX_STAGE_REQUEST_BYTES = 64 * 1024 * 1024;
