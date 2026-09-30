/**
 * `@probara/core/metadata`: what a test process needs to speak about its test (the `probara.*`
 * metadata model and its recorder, case ids in titles, automation keys), without the modules that
 * report, read the configuration or reach the network. An adapter's test-side helpers load this
 * entry, inside the test framework's module registry, rather than the whole library.
 */
export {
  buildAutomationKey,
  type AutomationKeyOptions,
  type TestIdentity,
} from './automation-key.js';
export {
  extractCaseIds,
  extractTitlePathCaseIds,
  parseCaseDisplayId,
  parseCaseIdList,
  type CaseIdExtraction,
  type TitlePathCaseIdExtraction,
} from './case-ids.js';
export {
  applyMetadataMessage,
  CASE_ANNOTATION,
  emptyMetadata,
  readMetadataMessages,
  type AttemptMetadata,
  type CaseStep,
  type MetadataMessage,
} from './metadata.js';
export {
  createMetadataRecorder,
  type MetadataRecorder,
  type MetadataSink,
  type MetadataValues,
} from './metadata-recorder.js';
