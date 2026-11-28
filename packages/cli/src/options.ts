/**
 * The one registry of command-line options: it drives parsing, the `--help` of every command and
 * the options table of the docs. Options that map to core become core options; core reads the
 * environment itself, so the precedence (flags > `PROBARA_*` > CI detection > defaults) is core's.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  VIS_KINDS,
  VIS_RECORDING_LINK_STATUSES,
  VIS_SOURCES,
  VIS_STATUSES,
  type ProbaraOptions,
} from '@probara/core';
import { FAILS_ON_TESTS } from './exit-codes.js';
import { JUNIT_DIALECTS } from './junit/dialects.js';

export type CommandName =
  | 'import junit'
  | 'import results'
  | 'import cucumber'
  | 'run create'
  | 'run close'
  | 'sync gherkin'
  | 'snap finalize'
  | 'snap wait'
  | 'snap upload'
  | 'vis list'
  | 'vis get'
  | 'vis create'
  | 'vis update'
  | 'vis delete'
  | 'vis record'
  | 'vis recording-links list'
  | 'vis recording-links get'
  | 'vis recording-links create'
  | 'vis recording-links update'
  | 'vis recording-links revoke'
  | 'vis recording-links delete'
  | 'sourcemaps inject'
  | 'sourcemaps upload'
  | 'releases set-commits';

/**
 * `list` options repeat and split their values at commas; `repeatable` ones repeat and keep each
 * value whole, commas included.
 */
export type OptionType = 'boolean' | 'string' | 'integer' | 'list' | 'repeatable';

/** The core option a flag sets, as a path into {@link ProbaraOptions}. */
export type CoreOption =
  | 'projectId'
  | 'projects'
  | 'baseUrl'
  | 'run.ulid'
  | 'run.ulids'
  | 'run.name'
  | 'run.description'
  | 'run.environmentId'
  | 'run.environment'
  | 'run.milestoneId'
  | 'run.milestone'
  | 'run.plan'
  | 'run.configurationUlids'
  | 'run.configurations'
  | 'run.tags'
  | 'source'
  | 'source.branch'
  | 'source.commit'
  | 'source.buildUrl'
  | 'createMissingCases'
  | 'suiteUlid'
  | 'closeRun'
  | 'uploadAttachments'
  | 'rootDir'
  | 'resultsFile'
  | 'timeoutMs'
  | 'maxRetries'
  | 'chunkSize'
  | 'attachmentConcurrency'
  | 'statusMapping'
  | 'statusFilter'
  | 'assignFailedTo'
  | 'debug';

export interface OptionSpec {
  /** The long flag without its dashes: `project` is `--project`. */
  readonly name: string;
  /** A one-letter alias: `h` is `-h`. */
  readonly short?: string;
  /**
   * `list` options repeat (`--tag a --tag b`) and take comma-separated values (`--tag a,b`);
   * `repeatable` ones repeat, each value taken whole.
   */
  readonly type: OptionType;
  /** How the value is shown in the help: `<code>`. */
  readonly value?: string;
  /** Booleans only: `both` accepts `--x` and `--no-x`; `only` accepts `--no-x` alone. */
  readonly negation?: 'both' | 'only';
  /** The values a string option accepts. */
  readonly choices?: readonly string[];
  /** The core option it sets; none for an option of the CLI itself. */
  readonly core?: CoreOption;
  /** The variable core reads for the same setting; none when the option has no variable. */
  readonly env?: string;
  /** The default, as the help and the docs show it. */
  readonly default?: string;
  readonly description: string;
  /** What the option also means for one command, appended to its description there. */
  readonly commandDetails?: Readonly<Partial<Record<CommandName, string>>>;
  /** A description that replaces `description` in the help of one command. */
  readonly commandDescriptions?: Readonly<Partial<Record<CommandName, string>>>;
  readonly commands: readonly CommandName[];
}

/** Options of the JUnit import alone. */
const IMPORT: readonly CommandName[] = ['import junit'];
/** Options of the imports that send results: JUnit, results files and Cucumber JSON. */
const IMPORTS: readonly CommandName[] = ['import junit', 'import results', 'import cucumber'];
/** Options of the imports that upload the files a result references: Cucumber JSON has none. */
const UPLOADS: readonly CommandName[] = ['import junit', 'import results'];
/** Options of the sync of feature files, which takes the same scope and folder options. */
const SYNC: readonly CommandName[] = ['sync gherkin'];
/** Options of a new run: an import creates one unless it reuses one. */
const NEW_RUN: readonly CommandName[] = [...IMPORTS, 'run create'];
const EXISTING_RUN: readonly CommandName[] = [...IMPORTS, 'run close'];
const EVERY_COMMAND: readonly CommandName[] = [...IMPORTS, 'run create', 'run close', ...SYNC];
/** The imports and the sync: a dry run and the root directory mean the same in each. */
const IMPORTS_AND_SYNC: readonly CommandName[] = [...IMPORTS, ...SYNC];
/** The Vis commands: they need the token, never a project (a Vis belongs to the organization). */
export const VIS_COMMANDS: readonly CommandName[] = [
  'vis list',
  'vis get',
  'vis create',
  'vis update',
  'vis delete',
  'vis record',
  'vis recording-links list',
  'vis recording-links get',
  'vis recording-links create',
  'vis recording-links update',
  'vis recording-links revoke',
  'vis recording-links delete',
];
/** The Probara Snap commands: they name a build of a project by its name and its nonce. */
const SNAP_COMMANDS: readonly CommandName[] = ['snap finalize', 'snap wait', 'snap upload'];
/** The source map commands: `inject` changes local files, `upload` sends them to a project. */
const SOURCEMAP_COMMANDS: readonly CommandName[] = ['sourcemaps inject', 'sourcemaps upload'];
/** The commands of the error monitoring that send to a project: they need a release. */
const RELEASE_COMMANDS: readonly CommandName[] = ['sourcemaps upload', 'releases set-commits'];
/** The commands that call Probara: the connection options. */
const CONNECTED_COMMANDS: readonly CommandName[] = [
  ...EVERY_COMMAND,
  ...SNAP_COMMANDS,
  ...VIS_COMMANDS,
  ...RELEASE_COMMANDS,
];
/** Every command: the output options. */
const ALL_COMMANDS: readonly CommandName[] = [...CONNECTED_COMMANDS, 'sourcemaps inject'];
/** The commands that take a title, a description and a folder for a Vis. */
const VIS_WRITES: readonly CommandName[] = ['vis create', 'vis update', 'vis record'];
/** The commands that create a Vis. */
const VIS_CREATES: readonly CommandName[] = ['vis create', 'vis record'];
/** The commands that create or change a recording link. */
const LINK_WRITES: readonly CommandName[] = [
  'vis recording-links create',
  'vis recording-links update',
];

export const OPTIONS: readonly OptionSpec[] = [
  {
    name: 'project',
    type: 'string',
    value: '<code>',
    core: 'projectId',
    env: 'PROBARA_PROJECT',
    description: 'Project code, such as SHOP',
    commandDetails: { 'import junit': 'case ids in test names use it' },
    commandDescriptions: {
      'sourcemaps upload': 'Code of the project the source maps belong to',
      'releases set-commits': 'Code of the project the release belongs to',
    },
    commands: [...EVERY_COMMAND, ...SNAP_COMMANDS, ...RELEASE_COMMANDS],
  },
  {
    name: 'projects',
    type: 'list',
    value: '<code>',
    core: 'projects',
    env: 'PROBARA_PROJECTS',
    description: 'Another project whose cases results may go to, each in its own run',
    commands: IMPORTS,
  },
  {
    name: 'base-url',
    type: 'string',
    value: '<url>',
    core: 'baseUrl',
    env: 'PROBARA_BASE_URL',
    default: 'https://app.probara.net',
    description: 'Probara URL',
    commands: CONNECTED_COMMANDS,
  },
  {
    name: 'build-name',
    type: 'string',
    value: '<name>',
    env: 'PROBARA_SNAP_BUILD_NAME',
    default: 'default',
    description: 'Name of the Snap build, as the machines of the run sent it',
    commandDescriptions: { 'snap upload': 'Name of the Snap build' },
    commands: SNAP_COMMANDS,
  },
  {
    name: 'nonce',
    type: 'string',
    value: '<nonce>',
    env: 'PROBARA_SNAP_NONCE',
    default: 'detected from the CI',
    description: 'What the machines of the run share, as they sent it',
    commandDescriptions: {
      'snap upload':
        'What the jobs of a run share, to join one build; the CI gives it with --shard or --parallel',
    },
    commands: SNAP_COMMANDS,
  },
  {
    name: 'build',
    type: 'string',
    value: '<ulid>',
    description: 'ULID of the Snap build, instead of its name and nonce or commit',
    commands: ['snap wait'],
  },
  {
    name: 'max-wait',
    type: 'integer',
    value: '<seconds>',
    default: '900 (15 minutes)',
    description: 'How long to wait for the build to be compared, in seconds',
    commands: ['snap wait'],
  },
  {
    name: 'fail-on-changes',
    type: 'boolean',
    description: 'Exit 4 when the build has changes its review did not accept',
    commands: ['snap wait'],
  },
  {
    name: 'shard',
    type: 'string',
    value: '<index/total>',
    description:
      'This job is one shard of a run split in total jobs, from 1, such as 2/3: the shards join one build by their nonce',
    commands: ['snap upload'],
  },
  {
    name: 'parallel',
    type: 'boolean',
    description:
      'This job is one machine of a run split without a total: it joins the build of the nonce, which probara snap finalize completes',
    commands: ['snap upload'],
  },
  {
    name: 'browser',
    type: 'string',
    value: '<name>',
    description: 'Browser every screenshot was taken in, such as chromium',
    commands: ['snap upload'],
  },
  {
    name: 'viewport',
    type: 'string',
    value: '<WxH>',
    description: 'Viewport every screenshot was taken at, such as 1280x720',
    commands: ['snap upload'],
  },
  {
    name: 'color-mode',
    type: 'string',
    value: '<mode>',
    choices: ['light', 'dark'],
    description: 'Color mode every screenshot was taken in',
    commands: ['snap upload'],
  },
  {
    name: 'run-ulid',
    type: 'string',
    value: '<ulid>',
    core: 'run.ulid',
    env: 'PROBARA_RUN_ULID',
    description: 'An existing run: import into it instead of creating one, or close it',
    commandDescriptions: { 'snap upload': 'The run the build belongs to' },
    commands: [...EXISTING_RUN, 'snap upload'],
  },
  {
    name: 'run-ulids',
    type: 'list',
    value: '<code=ulid>',
    core: 'run.ulids',
    env: 'PROBARA_RUN_ULIDS',
    description: 'An existing run of a project to import into, such as WEB=<ulid>',
    commands: IMPORTS,
  },
  {
    name: 'run-name',
    type: 'string',
    value: '<name>',
    core: 'run.name',
    env: 'PROBARA_RUN_NAME',
    default: 'the CI build name, else "Automated run <date> UTC"',
    description: 'Name of a new run',
    commands: NEW_RUN,
  },
  {
    name: 'run-description',
    type: 'string',
    value: '<text>',
    core: 'run.description',
    env: 'PROBARA_RUN_DESCRIPTION',
    description: 'Description of a new run',
    commands: NEW_RUN,
  },
  {
    name: 'environment-id',
    type: 'string',
    value: '<ulid>',
    core: 'run.environmentId',
    env: 'PROBARA_ENVIRONMENT_ID',
    description: 'Environment of a new run',
    commands: NEW_RUN,
  },
  {
    name: 'environment',
    type: 'string',
    value: '<name>',
    core: 'run.environment',
    env: 'PROBARA_ENVIRONMENT',
    description: 'Environment of a new run by name',
    commands: NEW_RUN,
  },
  {
    name: 'milestone-id',
    type: 'string',
    value: '<ulid>',
    core: 'run.milestoneId',
    env: 'PROBARA_MILESTONE_ID',
    description: 'Milestone of a new run',
    commands: NEW_RUN,
  },
  {
    name: 'milestone',
    type: 'string',
    value: '<ref>',
    core: 'run.milestone',
    env: 'PROBARA_MILESTONE',
    description: 'Milestone of a new run by display id (M-3) or name',
    commands: NEW_RUN,
  },
  {
    name: 'plan',
    type: 'string',
    value: '<ref>',
    core: 'run.plan',
    env: 'PROBARA_PLAN',
    description: 'Test plan of a new run by display id (PLAN-2) or name',
    commands: NEW_RUN,
  },
  {
    name: 'configuration',
    type: 'list',
    value: '<ulid>',
    core: 'run.configurationUlids',
    env: 'PROBARA_CONFIGURATION_ULIDS',
    description: 'Configuration of a new run',
    commands: NEW_RUN,
  },
  {
    name: 'configuration-value',
    type: 'list',
    value: '<pair>',
    core: 'run.configurations',
    env: 'PROBARA_CONFIGURATIONS',
    description: 'Configuration of a new run by name, such as Browser=Chrome',
    commands: NEW_RUN,
  },
  {
    name: 'tag',
    type: 'list',
    value: '<tag>',
    core: 'run.tags',
    env: 'PROBARA_RUN_TAGS',
    description: 'Tag of a new run',
    commands: NEW_RUN,
  },
  {
    name: 'branch',
    type: 'string',
    value: '<name>',
    core: 'source.branch',
    env: 'PROBARA_BRANCH',
    default: 'detected from the CI',
    description: 'Branch of the run source',
    commands: NEW_RUN,
  },
  {
    name: 'commit',
    type: 'string',
    value: '<sha>',
    core: 'source.commit',
    env: 'PROBARA_COMMIT',
    default: 'detected from the CI',
    description: 'Commit of the run source',
    commands: NEW_RUN,
  },
  {
    name: 'build-url',
    type: 'string',
    value: '<url>',
    core: 'source.buildUrl',
    env: 'PROBARA_BUILD_URL',
    default: 'detected from the CI',
    description: 'CI build URL of the run source',
    commands: NEW_RUN,
  },
  {
    name: 'source',
    type: 'boolean',
    negation: 'only',
    core: 'source',
    description: 'Send no run source (branch, commit, build URL)',
    commands: NEW_RUN,
  },
  {
    name: 'create-missing-cases',
    type: 'boolean',
    negation: 'both',
    core: 'createMissingCases',
    env: 'PROBARA_CREATE_MISSING_CASES',
    default: 'true',
    description: 'Create a case for a test that matches none',
    commands: IMPORTS,
  },
  {
    name: 'suite-ulid',
    type: 'string',
    value: '<ulid>',
    core: 'suiteUlid',
    env: 'PROBARA_SUITE_ULID',
    default: 'the project root',
    description: 'Suite that created cases go under',
    commands: [...IMPORTS, ...SYNC],
  },
  {
    name: 'close-run',
    type: 'boolean',
    negation: 'both',
    core: 'closeRun',
    env: 'PROBARA_CLOSE_RUN',
    default: 'true for a new run, false for an existing one (--run-ulid)',
    description: 'Close the run after the import',
    commands: IMPORTS,
  },
  {
    name: 'attachments',
    type: 'boolean',
    negation: 'both',
    core: 'uploadAttachments',
    env: 'PROBARA_UPLOAD_ATTACHMENTS',
    default: 'true',
    description: 'Upload the files the reports reference',
    commands: UPLOADS,
  },
  {
    name: 'attach-output',
    type: 'boolean',
    description: "Also attach each testcase's system-out and system-err as text files",
    commands: IMPORT,
  },
  {
    name: 'dialect',
    type: 'string',
    value: '<name>',
    choices: ['auto', ...JUNIT_DIALECTS],
    default: 'auto',
    description: 'JUnit dialect of every file, instead of detecting it per file',
    commands: IMPORT,
  },
  {
    name: 'error-status',
    type: 'string',
    value: '<status>',
    choices: ['failed', 'blocked'],
    default: 'failed',
    description: 'Status of a testcase with an <error>',
    commands: IMPORT,
  },
  {
    name: 'status-mapping',
    type: 'list',
    value: '<from=to>',
    core: 'statusMapping',
    env: 'PROBARA_STATUS_MAPPING',
    description: 'Send the results of one status with another, such as failed=blocked',
    commands: IMPORTS,
  },
  {
    name: 'status-filter',
    type: 'list',
    value: '<status>',
    core: 'statusFilter',
    env: 'PROBARA_STATUS_FILTER',
    description: 'Send no result with this status, after --status-mapping',
    commands: IMPORTS,
  },
  {
    name: 'assign-failed-to',
    type: 'list',
    value: '<email>',
    core: 'assignFailedTo',
    env: 'PROBARA_ASSIGN_FAILED_TO',
    description: 'Assign failed results without an assignee to this member, in turn',
    commands: IMPORTS,
  },
  {
    name: 'root-dir',
    type: 'string',
    value: '<dir>',
    core: 'rootDir',
    default: 'the current directory',
    description: 'Directory the file paths of automation keys are relative to',
    commandDetails: {
      'import results': "the results file's own comes first",
      'sync gherkin': 'the repository root, so the file links open',
    },
    commands: IMPORTS_AND_SYNC,
  },
  {
    name: 'file-url',
    type: 'string',
    value: '<url>',
    default: 'the CI link of the file and line, when the CI is known',
    description:
      'Link of each scenario: {path} and {line} are filled in, such as https://git.example.com/repo/blob/main/{path}#L{line}; only https links are sent',
    commands: SYNC,
  },
  {
    name: 'fail-on-failed-tests',
    type: 'boolean',
    description: 'Exit 3 for a failed or blocked test, or an unhandled error left out',
    commands: FAILS_ON_TESTS,
  },
  {
    name: 'dry-run',
    type: 'boolean',
    description: 'Print what would be sent, and send nothing (no token needed)',
    commandDescriptions: {
      'sync gherkin':
        'Show what the sync would do, and write nothing; Probara computes the outcome, so it needs the token and the project',
      'sourcemaps inject': 'Print what would be injected, and write nothing',
      'sourcemaps upload':
        'Print the debug ID, URL and file of each map that would be uploaded, and send nothing (no token needed)',
      'releases set-commits':
        'Print the JSON body that would be sent, and send nothing (no token needed)',
    },
    commands: [...IMPORTS_AND_SYNC, ...SOURCEMAP_COMMANDS, 'releases set-commits'],
  },
  {
    name: 'results-file',
    type: 'string',
    value: '<path>',
    core: 'resultsFile',
    env: 'PROBARA_RESULTS_FILE',
    description: 'JSON file the results that were not sent are written to',
    commands: ['import junit'],
  },
  {
    name: 'kind',
    type: 'string',
    value: '<kind>',
    choices: VIS_KINDS,
    description: 'Only the Vises of this kind',
    commands: ['vis list'],
  },
  {
    name: 'from',
    type: 'string',
    value: '<source>',
    choices: VIS_SOURCES,
    description: 'Only the Vises made from this source',
    commands: ['vis list'],
  },
  {
    name: 'creator',
    type: 'string',
    value: '<ulid>',
    description: 'Only the Vises this member (user ULID) created',
    commands: ['vis list'],
  },
  {
    name: 'status',
    type: 'string',
    value: '<status>',
    choices: VIS_STATUSES,
    default: 'ready',
    description: 'Only the Vises in this status; pending lists only your own',
    commands: ['vis list'],
  },
  {
    name: 'search',
    type: 'string',
    value: '<text>',
    description: 'Only the Vises whose title contains this text, ignoring case',
    commands: ['vis list'],
  },
  {
    name: 'page',
    type: 'integer',
    value: '<n>',
    default: '1',
    description: 'Page to list, from 1',
    commands: ['vis list', 'vis recording-links list'],
  },
  {
    name: 'page-size',
    type: 'integer',
    value: '<n>',
    default: '50',
    description: 'Vises per page, 1 to 200',
    commandDescriptions: { 'vis recording-links list': 'Links per page, 1 to 200' },
    commands: ['vis list', 'vis recording-links list'],
  },
  {
    name: 'title',
    type: 'string',
    value: '<text>',
    description: 'Title of the Vis, 1 to 200 characters',
    commandDetails: {
      'vis create': 'the file name when omitted',
      'vis record': 'the title of the page when omitted',
    },
    commandDescriptions: {
      'vis recording-links create':
        'The default title of the Vises the link receives, 1 to 200 characters',
      'vis recording-links update':
        'The default title of the Vises the link receives, 1 to 200 characters',
    },
    commands: [...VIS_WRITES, ...LINK_WRITES],
  },
  {
    name: 'description',
    type: 'string',
    value: '<markdown>',
    description: 'Description of the Vis, in Markdown',
    commandDetails: { 'vis update': 'an empty one clears it' },
    commands: VIS_WRITES,
  },
  {
    name: 'folder',
    type: 'string',
    value: '<ulid>',
    description: 'Folder of the Vis (its ULID)',
    commandDescriptions: {
      'vis list': 'Only the Vises in this folder (its ULID), or none for the Vises in no folder',
      'vis update': 'Move the Vis to this folder (its ULID), or none to take it out of its folder',
      'vis recording-links create':
        'The folder the Vises the link receives go into (its ULID), never a private one',
      'vis recording-links update':
        'Send the Vises the link receives to this folder (its ULID, never a private one), or none for no folder',
    },
    commands: ['vis list', ...VIS_WRITES, ...LINK_WRITES],
  },
  {
    name: 'visibility',
    type: 'string',
    value: '<mode>',
    choices: ['public', 'private'],
    description:
      'public: every member of the organization sees the Vis; private: only you, the members and groups granted it, and owners and admins',
    commands: ['vis update'],
  },
  {
    name: 'private',
    type: 'boolean',
    description:
      'Create the Vis private: only you, the members and groups you grant, and owners and admins see it',
    commands: VIS_CREATES,
  },
  {
    name: 'page-url',
    type: 'string',
    value: '<url>',
    description: 'The http or https URL of the page the recording or screenshot shows',
    commands: ['vis create'],
  },
  {
    name: 'metadata',
    type: 'repeatable',
    value: '<key=value>',
    description: 'Custom metadata of the Vis, such as build=1.42.0; at most 10 KB in all',
    commands: VIS_CREATES,
  },
  {
    name: 'duration-ms',
    type: 'integer',
    value: '<ms>',
    default: 'read from the MP4 or WebM file',
    description:
      'Length of the video in milliseconds; required when the file does not record its length',
    commands: ['vis create'],
  },
  {
    name: 'playwright-trace',
    type: 'string',
    value: '<trace.zip>',
    description:
      'Playwright trace of the video: its console messages, network requests and actions are uploaded as the diagnostics of the Vis, redacted',
    commands: ['vis create'],
  },
  {
    name: 'cdp',
    type: 'string',
    value: '<endpoint>',
    description:
      'The Chrome DevTools Protocol endpoint of the browser: its debugging port, such as http://127.0.0.1:9222, or the WebSocket debugger URL of the browser or of one page',
    commands: ['vis record'],
  },
  {
    name: 'target',
    type: 'string',
    value: '<page>',
    description:
      'The page to record: its target id, or part of its URL; required when the browser has several pages',
    commands: ['vis record'],
  },
  {
    name: 'duration',
    type: 'integer',
    value: '<seconds>',
    default: "until stopped, at most the plan's longest recording",
    description: 'Stop the recording after this many seconds',
    commands: ['vis record'],
  },
  {
    name: 'state',
    type: 'string',
    value: '<state>',
    choices: VIS_RECORDING_LINK_STATUSES,
    default: 'every link',
    description: 'Only the active links, or only the revoked ones',
    commands: ['vis recording-links list'],
  },
  {
    name: 'reference',
    type: 'string',
    value: '<text>',
    description:
      'Text kept on every Vis the link receives, such as a ticket number; at most 200 characters',
    commandDetails: { 'vis recording-links update': 'an empty one clears it' },
    commands: LINK_WRITES,
  },
  {
    name: 'one-time',
    type: 'boolean',
    description: 'The first recording takes the link: it then stops working',
    commands: ['vis recording-links create'],
  },
  {
    name: 'expires',
    type: 'string',
    value: '<time>',
    description:
      'When the link stops working: a date and time with its time zone, such as 2026-12-31T18:00:00Z, or never',
    commandDetails: { 'vis recording-links create': 'never when omitted' },
    commands: LINK_WRITES,
  },
  {
    name: 'microphone',
    type: 'boolean',
    negation: 'both',
    description:
      'Start the recorder of the link with the microphone on, or off with --no-microphone',
    commandDetails: { 'vis recording-links create': 'off when omitted' },
    commands: LINK_WRITES,
  },
  {
    name: 'yes',
    type: 'boolean',
    description: 'Delete without asking for a confirmation (required when stdin is not a terminal)',
    commandDescriptions: {
      'vis recording-links revoke':
        'Revoke without asking for a confirmation (required when stdin is not a terminal)',
    },
    commands: ['vis delete', 'vis recording-links revoke', 'vis recording-links delete'],
  },
  {
    name: 'release',
    type: 'string',
    value: '<release>',
    description:
      'Release the source maps belong to, as the error monitoring SDK sends it (its release option); required',
    commandDescriptions: {
      'releases set-commits':
        'Release the commits belong to, as the error monitoring SDK sends it (its release option); required',
    },
    commands: RELEASE_COMMANDS,
  },
  {
    name: 'url-prefix',
    type: 'string',
    value: '<prefix>',
    default: '~/',
    description:
      'What comes before the path of each file from its directory in the URL it is served at; ~/ stands for any scheme and host, such as "~/assets" (quoted, or the shell expands ~)',
    commands: ['sourcemaps upload'],
  },
  {
    name: 'auto',
    type: 'boolean',
    description:
      'Set the HEAD commit of the local repository as the head of the release, in the GitHub repository of its origin remote: Probara fetches the commits since the previous release',
    commands: ['releases set-commits'],
  },
  {
    name: 'commit',
    type: 'repeatable',
    value: '<owner/name@sha>',
    description:
      'A GitHub repository and the commit the release ends at, such as acme/shop@4f2a9c1, or acme/shop@<previous>..<sha> with the commit it starts after; Probara fetches the commits; at most 10',
    commands: ['releases set-commits'],
  },
  {
    name: 'local',
    type: 'boolean',
    description:
      'Send the commits of the local git log, with their authors, times and files, in the GitHub repository of the origin remote',
    commands: ['releases set-commits'],
  },
  {
    name: 'previous-commit',
    type: 'string',
    value: '<sha>',
    description: 'With --local: send the commits after this one, at most 100',
    commands: ['releases set-commits'],
  },
  {
    name: 'initial-depth',
    type: 'integer',
    value: '<n>',
    default: '20',
    description: 'With --local and no --previous-commit: send the last n commits, 1 to 100',
    commands: ['releases set-commits'],
  },
  {
    name: 'timeout',
    type: 'integer',
    value: '<ms>',
    core: 'timeoutMs',
    default: '30000',
    description: 'Timeout of one HTTP attempt, in milliseconds',
    commands: CONNECTED_COMMANDS,
  },
  {
    name: 'max-retries',
    type: 'integer',
    value: '<n>',
    core: 'maxRetries',
    default: '4',
    description: 'Retries of a failed request, 0 to 10',
    commands: CONNECTED_COMMANDS,
  },
  {
    name: 'chunk-size',
    type: 'integer',
    value: '<n>',
    core: 'chunkSize',
    default: '500',
    description: 'Results per report request, 1 to 500',
    commands: IMPORTS,
  },
  {
    name: 'attachment-concurrency',
    type: 'integer',
    value: '<n>',
    core: 'attachmentConcurrency',
    default: '2',
    description: 'Results whose attachments upload at the same time, 1 to 8',
    commands: UPLOADS,
  },
  {
    name: 'json',
    type: 'boolean',
    description: 'Print a JSON summary on stdout',
    commandDescriptions: {
      'snap wait': 'Print the build as JSON on stdout, once it is read',
      'vis list': 'Print the page of Vises as JSON on stdout',
      'vis get': 'Print the Vis as JSON on stdout',
      'vis create': 'Print the created Vis, with its url, as JSON on stdout',
      'vis record': 'Print the created Vis, with its url, as JSON on stdout',
      'vis update': 'Print the updated Vis as JSON on stdout',
      'vis recording-links list': 'Print the page of links as JSON on stdout',
      'vis recording-links get': 'Print the link as JSON on stdout',
      'vis recording-links create': 'Print the created link as JSON on stdout',
      'vis recording-links update': 'Print the updated link as JSON on stdout',
      'vis recording-links revoke': 'Print the revoked link as JSON on stdout',
      'sourcemaps inject':
        'Print each file, its map, its debug ID and its outcome as JSON on stdout',
      'sourcemaps upload': 'Print the uploaded and failed maps as JSON on stdout',
      'releases set-commits':
        'Print the recorded commits and the resolved issues as JSON on stdout',
    },
    commands: ALL_COMMANDS,
  },
  {
    name: 'debug',
    type: 'boolean',
    core: 'debug',
    env: 'PROBARA_DEBUG',
    default: 'false',
    description: 'Log every request',
    commands: CONNECTED_COMMANDS,
  },
  {
    name: 'help',
    short: 'h',
    type: 'boolean',
    description: 'Show this help',
    commands: ALL_COMMANDS,
  },
];

/** The description of `option` in the help of `command`, with its detail there. */
export function describeOption(option: OptionSpec, command: CommandName): string {
  const description = option.commandDescriptions?.[command] ?? option.description;
  const detail = option.commandDetails?.[command];
  return detail === undefined ? description : `${description}; ${detail}`;
}

/** The options of one command, in registry order. */
export function optionsOf(command: CommandName): OptionSpec[] {
  return OPTIONS.filter((option) => option.commands.includes(command));
}

/** A command line that cannot run: exit 2, with a pointer to the help of `helpCommand`. */
export class UsageError extends Error {
  override readonly name = 'UsageError';

  constructor(
    message: string,
    /** The command whose `--help` explains the fix, such as `probara import junit`. */
    readonly helpCommand: string,
  ) {
    super(message);
  }
}

export type OptionValue = boolean | string | number | string[];

export interface ParsedCommandLine {
  /** Only the options given, by name. */
  values: ReadonlyMap<string, OptionValue>;
  positionals: string[];
}

const TOKEN_FLAGS: ReadonlySet<string> = new Set(['--token', '--api-token']);

/** The arguments before `--`, where options live. */
function optionArgs(args: readonly string[]): readonly string[] {
  const end = args.indexOf('--');
  return end === -1 ? args : args.slice(0, end);
}

/** Whether `-h` or `--help` is among the options: the help wins over everything else. */
export function wantsHelp(args: readonly string[]): boolean {
  return optionArgs(args).some((arg) => arg === '-h' || arg === '--help');
}

function listValues(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * Parses the arguments of `command` against its options (`--x`, `--x=v`, `--x v`, `--no-x`).
 *
 * @throws UsageError on an unknown option, a missing or invalid value, or a `--token`.
 */
export function parseCommandLine(command: CommandName, args: readonly string[]): ParsedCommandLine {
  const helpCommand = `probara ${command}`;
  for (const arg of optionArgs(args)) {
    // The value is never echoed: it is a secret.
    if (TOKEN_FLAGS.has(arg.split('=')[0] ?? '')) {
      throw new UsageError(
        'There is no --token option: set the API token in the PROBARA_API_TOKEN variable (a command line shows up in process lists and CI logs)',
        helpCommand,
      );
    }
  }

  const specs = optionsOf(command);
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const { tokens } = parseArgs({
    args: [...args],
    options: Object.fromEntries(
      specs.map((spec) => [
        spec.name,
        {
          type: spec.type === 'boolean' ? 'boolean' : 'string',
          ...(spec.type === 'list' || spec.type === 'repeatable' ? { multiple: true } : {}),
          ...(spec.short === undefined ? {} : { short: spec.short }),
        } as const,
      ]),
    ),
    strict: false,
    allowPositionals: true,
    allowNegative: true,
    tokens: true,
  });

  const values = new Map<string, OptionValue>();
  const positionals: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'positional') positionals.push(token.value);
    if (token.kind !== 'option') continue;

    const { rawName } = token;
    const negated = rawName.startsWith('--no-');
    // A known short option comes with its long name.
    const spec = byName.get(token.name);
    const unknown =
      spec === undefined ||
      (negated && spec.negation === undefined) ||
      (!negated && spec.negation === 'only');
    if (unknown) throw new UsageError(`Unknown option '${rawName}'`, helpCommand);

    const flag = `--${spec.name}`;
    if (spec.type === 'boolean') {
      if (token.value !== undefined) throw new UsageError(`${flag} takes no value`, helpCommand);
      values.set(spec.name, !negated);
      continue;
    }
    const { value } = token;
    // Without `=`, a value that looks like an option is the next option, not this one's value.
    if (value === undefined || (!token.inlineValue && value.startsWith('-'))) {
      throw new UsageError(`${flag} needs a value`, helpCommand);
    }
    if (spec.type === 'integer') {
      if (!/^\d+$/.test(value.trim())) {
        throw new UsageError(`${flag} must be a whole number`, helpCommand);
      }
      values.set(spec.name, Number(value.trim()));
    } else if (spec.type === 'list' || spec.type === 'repeatable') {
      const previous = values.get(spec.name);
      const given = spec.type === 'list' ? listValues(value) : [value];
      values.set(spec.name, [...(Array.isArray(previous) ? previous : []), ...given]);
    } else {
      if (spec.choices !== undefined && !spec.choices.includes(value)) {
        throw new UsageError(`${flag} must be one of ${spec.choices.join(', ')}`, helpCommand);
      }
      values.set(spec.name, value);
    }
  }
  return { values, positionals };
}

function listOf(value: OptionValue): string[] {
  return Array.isArray(value) ? value : [String(value)];
}

/** A string value of `values`, when given. */
export function stringOf(
  values: ReadonlyMap<string, OptionValue>,
  name: string,
): string | undefined {
  const value = values.get(name);
  return typeof value === 'string' ? value : undefined;
}

/**
 * `--status-mapping` pairs (`failed=blocked`) as core's status mapping, in any case. Unknown
 * statuses are left to core, which reports them like the variable's.
 *
 * @throws UsageError on a value that is not a pair, or a status mapped twice.
 */
function statusMappingOf(pairs: readonly string[], command: CommandName): Record<string, string> {
  // Without a prototype, `__proto__=failed` is an unknown status like any other, not a setter.
  const mapping = Object.create(null) as Record<string, string>;
  for (const pair of pairs) {
    const parts = pair.split('=').map((part) => part.trim().toLowerCase());
    const [from, to] = parts;
    if (parts.length !== 2 || from === undefined || to === undefined || from === '' || to === '') {
      throw new UsageError(
        '--status-mapping takes <status>=<status> pairs, such as failed=blocked',
        `probara ${command}`,
      );
    }
    if (Object.hasOwn(mapping, from)) {
      throw new UsageError('--status-mapping maps a status twice', `probara ${command}`);
    }
    mapping[from] = to;
  }
  return mapping;
}

/**
 * `--run-ulids` pairs (`WEB=01J…`) as core's `run.ulids`. Project codes and ULIDs are left to core,
 * which reports them like the variable's.
 *
 * @throws UsageError on a value that is not a pair, or a project named twice.
 */
function runUlidsOf(pairs: readonly string[], command: CommandName): Record<string, string> {
  // Without a prototype, `__proto__=…` is a project code like any other, not a setter.
  const runs = Object.create(null) as Record<string, string>;
  for (const pair of pairs) {
    const parts = pair.split('=').map((part) => part.trim());
    const [code, ulid] = parts;
    if (
      parts.length !== 2 ||
      code === undefined ||
      ulid === undefined ||
      code === '' ||
      ulid === ''
    ) {
      throw new UsageError(
        '--run-ulids takes <project>=<run ULID> pairs, such as WEB=01J9Z3K4M5N6P7Q8R9S0T1V2W3',
        `probara ${command}`,
      );
    }
    if (Object.hasOwn(runs, code)) {
      throw new UsageError('--run-ulids names the run of a project twice', `probara ${command}`);
    }
    runs[code] = ulid;
  }
  return runs;
}

/**
 * `--configuration-value` pairs (`Browser=Chrome`, split at the first `=`) as core's
 * `run.configurations`. Names are left to core, which checks them like the variable's.
 *
 * @throws UsageError on a value that is not a pair.
 */
function configurationsOf(
  pairs: readonly string[],
  command: CommandName,
): { group: string; name: string }[] {
  return pairs.map((pair) => {
    const separator = pair.indexOf('=');
    const group = separator === -1 ? '' : pair.slice(0, separator).trim();
    const name = separator === -1 ? '' : pair.slice(separator + 1).trim();
    if (group === '' || name === '') {
      throw new UsageError(
        '--configuration-value takes <group>=<name> pairs, such as Browser=Chrome',
        `probara ${command}`,
      );
    }
    return { group, name };
  });
}

/**
 * The core options of the flags given: only those given, so an unset flag never hides its
 * variable. `rootDir` and `resultsFile` are resolved against `cwd`.
 *
 * @throws UsageError on a malformed `--status-mapping`, `--run-ulids` or `--configuration-value`.
 */
export function toCoreOptions(
  command: CommandName,
  values: ReadonlyMap<string, OptionValue>,
  cwd: string,
): ProbaraOptions {
  const options: Record<string, unknown> = {};
  const run: Record<string, unknown> = {};
  const source: Record<string, unknown> = {};
  for (const spec of optionsOf(command)) {
    const value = values.get(spec.name);
    if (spec.core === undefined || value === undefined) continue;
    const [group, field] = spec.core.split('.');
    if (spec.core === 'run.ulids') run.ulids = runUlidsOf(listOf(value), command);
    else if (spec.core === 'run.configurations') {
      run.configurations = configurationsOf(listOf(value), command);
    } else if (group === 'run' && field !== undefined) run[field] = value;
    else if (group === 'source' && field !== undefined) source[field] = value;
    else if (spec.core === 'rootDir' || spec.core === 'resultsFile') {
      options[spec.core] = resolve(cwd, String(value));
    } else if (spec.core === 'statusMapping')
      options.statusMapping = statusMappingOf(listOf(value), command);
    else if (spec.core === 'statusFilter') {
      options.statusFilter = listOf(value).map((status) => status.toLowerCase());
    } else options[spec.core] = value;
  }
  if (Object.keys(run).length > 0) options.run = run;
  // `--no-source` wins over the source flags.
  if (options.source !== false && Object.keys(source).length > 0) options.source = source;
  return options;
}
