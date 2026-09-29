/**
 * Limits of `POST /api/v1/projects/{projectId}/reports`. One out-of-contract field rejects the
 * whole batch with 422, so core keeps every entry within them.
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

/** Name of a run the report creates, after trimming (1..200). */
export const MAX_RUN_NAME_LENGTH = 200;

/** Tags of a created run (at most 50). */
export const MAX_TAGS = 50;

/** One run tag (1..80). */
export const MAX_TAG_LENGTH = 80;

/** Configuration ULIDs of a created run (at most 20). */
export const MAX_CONFIGURATION_ULIDS = 20;

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
