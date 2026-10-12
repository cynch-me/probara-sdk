/**
 * The options an adapter takes beside core's own (`keyIncludesFile` of the Jest reporter, for
 * instance): the names core takes are kept, and every other name is left out with a warning. The
 * adapter takes its own names out first, by destructuring them.
 */
import type { ProbaraOptions } from './config.js';
import type { RuntimeOptions } from './runtime.js';

/** Every option core takes: the compiler keeps the list complete. */
const CORE_OPTIONS = {
  enabled: true,
  apiToken: true,
  projectId: true,
  baseUrl: true,
  run: true,
  source: true,
  createMissingCases: true,
  suiteUlid: true,
  closeRun: true,
  closeRuns: true,
  rootDir: true,
  debug: true,
  clientName: true,
  chunkSize: true,
  timeoutMs: true,
  maxRetries: true,
  uploadAttachments: true,
  attachmentConcurrency: true,
  statusMapping: true,
  statusFilter: true,
  projects: true,
  resultsFile: true,
  assignFailedTo: true,
  logger: true,
  env: true,
  fetch: true,
  sleep: true,
  random: true,
  now: true,
} satisfies Record<keyof (ProbaraOptions & RuntimeOptions), true>;

function isCoreOption(name: string): name is keyof typeof CORE_OPTIONS {
  return Object.hasOwn(CORE_OPTIONS, name);
}

/**
 * The options of `options` that core takes, under their own names, and a warning for each other
 * one, in the order the options have. The warning names `adapter`, the package the options came
 * from (`@probara/jest-reporter`), so a misspelled option says where it was written.
 */
export function splitCoreOptions(
  options: object,
  adapter: string,
): { core: ProbaraOptions & RuntimeOptions; warnings: string[] } {
  const core: Record<string, unknown> = {};
  const warnings: string[] = [];
  for (const [name, value] of Object.entries(options)) {
    if (isCoreOption(name)) core[name] = value;
    else warnings.push(`Ignored the unknown option "${name}" of ${adapter}`);
  }
  return { core, warnings };
}
