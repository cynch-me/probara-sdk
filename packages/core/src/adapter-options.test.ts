/**
 * The options an adapter takes beside core's own: the names core takes are kept, and every other
 * name the adapter left over is left out with a warning that names the adapter.
 */
import { describe, expect, it } from 'vitest';
import { splitCoreOptions } from './adapter-options.js';

/** Every option core takes, by name: a missing one would be a warning, not a kept option. */
const CORE_NAMES = [
  'enabled',
  'apiToken',
  'projectId',
  'baseUrl',
  'run',
  'source',
  'createMissingCases',
  'suiteUlid',
  'closeRun',
  'closeRuns',
  'rootDir',
  'debug',
  'clientName',
  'chunkSize',
  'timeoutMs',
  'maxRetries',
  'uploadAttachments',
  'attachmentConcurrency',
  'statusMapping',
  'statusFilter',
  'projects',
  'resultsFile',
  'assignFailedTo',
  'logger',
  'env',
  'fetch',
  'sleep',
  'random',
  'now',
];

describe('splitCoreOptions', () => {
  it('keeps every option core takes under its own name, without a warning', () => {
    const options = Object.fromEntries(CORE_NAMES.map((name) => [name, name]));

    const { core, warnings } = splitCoreOptions(options, '@probara/jest-reporter');

    expect(Object.keys(core)).toEqual(CORE_NAMES);
    expect(core).toMatchObject({ projectId: 'projectId', closeRuns: 'closeRuns' });
    expect(warnings).toEqual([]);
  });

  it('leaves out each option of no core, in the order given, and names the adapter in each warning', () => {
    const { core, warnings } = splitCoreOptions(
      { projectId: 'SHOP', caputureOutput: true, rootDirectory: '/app' },
      '@probara/cypress-reporter',
    );

    expect(core).toEqual({ projectId: 'SHOP' });
    expect(warnings).toEqual([
      'Ignored the unknown option "caputureOutput" of @probara/cypress-reporter',
      'Ignored the unknown option "rootDirectory" of @probara/cypress-reporter',
    ]);
  });

  it('treats a name that only an object inherits as unknown, not as an option core takes', () => {
    const { core, warnings } = splitCoreOptions({ toString: 1, constructor: 2 }, '@probara/x');

    expect(core).toEqual({});
    expect(warnings).toEqual([
      'Ignored the unknown option "toString" of @probara/x',
      'Ignored the unknown option "constructor" of @probara/x',
    ]);
  });

  it('gives back nothing for no options, and no warning', () => {
    expect(splitCoreOptions({}, '@probara/x')).toEqual({ core: {}, warnings: [] });
  });
});
