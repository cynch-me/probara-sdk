export type {
  ApiErrorBody,
  ReportEntryOutcome,
  ReportOptions,
  ReportRequest,
  ReportResponse,
  ReportResultEntry,
  ReportRunInput,
  ResultStatus,
  UnmatchedReason,
} from './api.js';
export {
  buildAutomationKey,
  type AutomationKeyOptions,
  type TestIdentity,
} from './automation-key.js';
export * from './limits.js';
export {
  toReportEntry,
  type ReportEntryContext,
  type ReportEntryConversion,
  type TestResultInput,
} from './result.js';
