/**
 * `@probara/core/browser`: the entry an adapter loads **in a browser**, where no Node built-in
 * exists — a Cypress support file, or any other test code a framework runs in a frame.
 *
 * It is `@probara/core/metadata` without `buildAutomationKey`, which hashes the key with
 * `node:crypto` and normalizes its file with `node:path`: the two cannot load there, and nothing
 * else this entry needs them for. Everything it exports is pure: the `probara.*` metadata model
 * and its recorder, the case ids of titles, and the transport protocol (the lines of one attempt,
 * and the run selection an adapter resolves with). The reporter side of a run reads those lines
 * in its own process with `detailsOf` from the main entry.
 *
 * `src/browser.test.ts` walks this file's whole graph and fails on the first `node:` specifier,
 * which is what keeps a helper out of one.
 */
export {
  extractCaseIds,
  extractTitlePathCaseIds,
  parseCaseDisplayId,
  parseCaseIdList,
  type CaseIdExtraction,
  type TitlePathCaseIdExtraction,
} from './case-ids.js';
export {
  attemptKey,
  parseSelection,
  SELECTION_FAILURES,
  type AttemptRef,
  type ChannelLine,
  type RunSelection,
  type SelectionFailure,
  type SelectionOutcome,
  type StepError,
} from './channel.js';
export type { ResultLink } from './links.js';
export {
  applyMetadataMessage,
  CASE_ANNOTATION,
  emptyMetadata,
  readMetadataMessages,
  type AttemptMetadata,
  type CaseStep,
  type MetadataLink,
  type MetadataMessage,
} from './metadata.js';
export {
  createMetadataRecorder,
  type MetadataRecorder,
  type MetadataSink,
  type MetadataValues,
} from './metadata-recorder.js';
