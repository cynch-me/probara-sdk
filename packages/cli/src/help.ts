/** The `--help` of every command, generated from the options registry. */
import { EXIT_CODES } from './exit-codes.js';
import { describeOption, optionsOf, type CommandName, type OptionSpec } from './options.js';

interface CommandHelp {
  usage: string;
  summary: string;
  /** Paragraphs after the usage line. */
  details: readonly string[];
  /** Lines of a shell example, printed as they are (never wrapped). */
  example?: readonly string[];
  /** Variables the command reads that have no flag. */
  environment: readonly (readonly [string, string])[];
}

const TOKEN_VARIABLE = [
  'PROBARA_API_TOKEN',
  'The API token (required). There is no flag for it: a command line leaks.',
] as const;
/** The Vis endpoints act as a person: an app token, bound to a reporting app, is refused there. */
const VIS_TOKEN_VARIABLE = [
  'PROBARA_API_TOKEN',
  'A personal API token (required): app tokens (probara_app_...) can only report results. There is no flag for it: a command line leaks.',
] as const;
const ENABLED_OFF = 'false turns reporting off: nothing is sent';
/**
 * An import still reads and checks its files, and fails on failed tests or on the unhandled errors
 * it left out, while reporting is off.
 */
const IMPORT_ENABLED_VARIABLE = [
  'PROBARA_ENABLED',
  `${ENABLED_OFF}. The files are still read, so a missing or invalid file exits 2, and --fail-on-failed-tests still exits 3 when a test failed or an unhandled error was left out.`,
] as const;
const ENABLED_VARIABLE = [
  'PROBARA_ENABLED',
  `${ENABLED_OFF}, and the exit code is 0 unless the command line is wrong (exit 2).`,
] as const;

export const COMMAND_HELP: Readonly<Record<CommandName, CommandHelp>> = {
  'import junit': {
    usage: 'probara import junit [options] <paths...>',
    summary: 'Import JUnit XML files into one Probara run',
    details: [
      'Each path is a file, a directory (every *.xml beneath it) or a glob, relative to the current directory. Quote globs so the shell leaves them to probara. Every file is parsed before anything is sent: one invalid file sends nothing.',
      'Tests link to cases by a probara_case property or by a <PROJECT>-<n> id in their name; the others match by automation key, and missing cases are created.',
    ],
    environment: [TOKEN_VARIABLE, IMPORT_ENABLED_VARIABLE],
  },
  'import results': {
    usage: 'probara import results [options] <paths...>',
    summary: 'Send results files: the results a reporter or an import could not send',
    details: [
      'A reporter or import with --results-file (PROBARA_RESULTS_FILE) writes the results it could not send to that JSON file, or every result while reporting is off; when a file is already there, it writes the first free sibling (probara-results-2.json, ...). This sends them, into the runs each file names (or the run it describes), with its project and settings; flags, then PROBARA_* variables, win over each file.',
      "Each path is a file or a glob, relative to the current directory: quote globs so the shell leaves them to probara, as in probara import results 'probara-results*.json'. Every file is read and checked before anything is sent: one that cannot be imported sends nothing. When no file matches, nothing was left unsent: the exit code is 0.",
      'Each file is consumed on its own: once every result in it was sent, it is deleted with its <name>-attachments folder; otherwise it is rewritten with only the results still unsent, so running this again never sends a result twice. An attachment whose upload failed is gone with it: the file no longer holds its result. --dry-run and PROBARA_ENABLED=false leave every file as it is.',
    ],
    environment: [TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'import cucumber': {
    usage: 'probara import cucumber [options] <paths...>',
    summary: 'Import Cucumber JSON reports as the results of their scenarios',
    details: [
      'Reads the Cucumber JSON that cucumber-js (--format json), Cucumber-JVM, Reqnroll and playwright-bdd write. Each path is a file, a directory (every *.json beneath it) or a glob, relative to the current directory. Every file is read and checked before anything is sent: one invalid file sends nothing.',
      'A scenario is keyed the way probara sync gherkin keys it: its feature file, read under --root-dir, gives its Feature and Scenario names, and each row of a Scenario Outline is a result with the Examples values as its parameters. A feature file that is not there keys the scenarios by the names in the report.',
    ],
    environment: [TOKEN_VARIABLE, IMPORT_ENABLED_VARIABLE],
  },
  'run create': {
    usage: 'probara run create [options]',
    summary: 'Create a run for sharded CI and print its ULID',
    details: [
      'Create the run once, before the shards: pass its ULID to every shard as PROBARA_RUN_ULID, and close it with probara run close once every shard reported. On success stdout holds the ULID alone. Assign it first, then export it: an export with the command inside exits 0 even when the creation failed.',
    ],
    example: [
      'PROBARA_RUN_ULID=$(probara run create --run-name "Nightly")',
      'export PROBARA_RUN_ULID',
    ],
    environment: [TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'run close': {
    usage: 'probara run close [options]',
    summary: 'Close a run once every shard reported into it',
    details: [
      'Closes the run of --run-ulid (PROBARA_RUN_ULID). Without one, in GitHub Actions, it closes the run the jobs of its workflow run reported into: run it in a final job, with needs on every test job and if: always().',
      'A run that is already closed (or aborted) counts as closed: the exit code is 0.',
    ],
    environment: [TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'sync gherkin': {
    usage: 'probara sync gherkin [options] <globs...>',
    summary: 'Sync the Gherkin scenarios of .feature files with the synced cases of a project',
    details: [
      'Each argument is a file, a directory (every .feature file beneath it) or a glob, relative to the current directory: quote globs so the shell leaves them to probara. Every file is parsed with the Gherkin parser before anything is sent: one that does not parse sends nothing. Paths are relative to --root-dir, which should be the repository root so the file links open.',
      'Each scenario is keyed <path> > <Feature> > <Scenario>. A synced case whose scenario is gone is archived, never deleted, and only when its file matches one of the arguments: the cases of other folders are left alone, so each folder can be synced by its own job. A scenario tagged @probara:<ID> is bound to that case, and a case whose content did not change keeps its history when the scenario moves.',
    ],
    example: ['probara sync gherkin "features/**/*.feature" --dry-run'],
    environment: [TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'snap finalize': {
    usage: 'probara snap finalize [options]',
    summary: 'Finalize the Snap build the machines of a Cypress run sent',
    details: [
      'For the machines of a Cypress run, which join one Probara Snap build by the nonce they share, without a total (snap: true in the reporter options of every machine): the build is complete once this command says so. Run it in a final job, after every machine, even when tests failed.',
      'The build is the one of --project with the name of --build-name and the nonce of --nonce, resolved as the reporter resolves them: without --nonce, the nonce the CI gives. A build that is already finalized counts as finalized: the exit code is 0. A run sharded with --shard (Playwright, Vitest) carries its total and needs no finalize: its last shard completes the build.',
    ],
    example: [
      'probara snap finalize',
      'probara snap finalize --build-name mobile --nonce "$PIPELINE_ID"',
    ],
    environment: [TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'vis list': {
    usage: 'probara vis list [options]',
    summary: "List the organization's Vises, newest first",
    details: [
      'Prints one line per Vis: its display ID, kind, status, creation date and title. Only the Vises you can see are listed, and only ready ones unless --status says otherwise. The log line after the list says which page this is and how many Vises match: pass --page for the next one.',
    ],
    example: ['probara vis list --kind video --search checkout'],
    environment: [VIS_TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'vis get': {
    usage: 'probara vis get [options] <id>',
    summary: 'Show one Vis',
    details: [
      'The id is the ULID of the Vis or its display ID, such as VIS-12. A Vis you cannot see is not found (exit 1).',
    ],
    example: ['probara vis get VIS-12'],
    environment: [VIS_TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'vis create': {
    usage: 'probara vis create [options] <file>',
    summary: 'Upload a recording or a screenshot as a new Vis',
    details: [
      'The file is an MP4 or WebM video, or a PNG, JPEG or WebP screenshot, recognized by its content. A video is uploaded in parts of 8 MiB, each retried on its own after a transient failure, and needs its length: it is read from the file, and --duration-ms gives it when the file does not record it (a WebM file written by a browser often does not). On success stdout holds the ULID, the display ID and the URL of the Vis, separated by spaces.',
      'With --playwright-trace, the trace archive Playwright recorded with the video is read first: its console messages, network requests (with their headers and bodies when the trace holds them) and the actions of the test (clicks, fills, key presses, navigations) are uploaded as the diagnostics of the Vis, timed from the start of the video. Credentials, cookies, tokens and passwords are redacted before anything leaves the machine, and typed values are masked. A trace that cannot be read sends nothing.',
      'The Vis is created pending and finalized once every file arrived. When an upload fails, the pending Vis is deleted again; if Probara cannot be reached for that either, it deletes the Vis seven days after its creation.',
    ],
    example: [
      'probara vis create test-results/checkout/video.webm \\',
      '  --playwright-trace test-results/checkout/trace.zip --title "Checkout fails"',
    ],
    environment: [VIS_TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'vis update': {
    usage: 'probara vis update [options] <id>',
    summary: 'Change the title, description, folder or visibility of a Vis',
    details: [
      'The id is the ULID of the Vis or its display ID, such as VIS-12. Only the options given change. Changing a Vis takes being its creator, or an owner or admin of the organization.',
    ],
    example: ['probara vis update VIS-12 --title "Checkout fails on Safari" --visibility private'],
    environment: [VIS_TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'vis delete': {
    usage: 'probara vis delete [options] <id>',
    summary: 'Delete a Vis and all its media',
    details: [
      'The id is the ULID of the Vis or its display ID, such as VIS-12. The command shows the Vis and asks for a confirmation on the terminal; --yes deletes without asking, and is required when stdin is not a terminal (in CI). A deleted Vis cannot be restored.',
    ],
    example: ['probara vis delete VIS-12 --yes'],
    environment: [VIS_TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'vis record': {
    usage: 'probara vis record [options] --cdp <endpoint>',
    summary: 'Record a page of a browser over the Chrome DevTools Protocol as a replay Vis',
    details: [
      'Attaches to a Chromium browser that has a debugging port (started with --remote-debugging-port, or driven by Playwright, Puppeteer or an agent) and records one page: the one --target names, or the only one. The capture script of @probara/vis-capture is injected into the page and into every document it navigates to. It records the page as a DOM replay, with the console, the network requests and the user actions, each timed from the start of the replay. Typed text is masked, password fields are never recorded, and elements marked data-probara-blur are left out. The browser receives the capture script and nothing else.',
      'The recording stops on Ctrl+C or SIGTERM, after --duration, when the page closes, or at the longest recording the plan allows, which the command reads from Probara before the recording starts (60 minutes when Probara does not answer it); a --duration longer than the plan allows stops there too. Then the Vis is created and uploaded: its length is the time recorded, never more than the limit. When Probara still refuses a recording as too long, the Vis keeps the recording up to the plan limit. Credentials, cookies, tokens and passwords are redacted in the page, and again before anything is sent. When nothing was captured, no Vis is created. On success stdout holds the ULID, the display ID and the URL of the Vis, separated by spaces.',
    ],
    example: [
      'probara vis record --cdp http://127.0.0.1:9222 --duration 60 --title "Checkout fails"',
    ],
    environment: [VIS_TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'vis recording-links list': {
    usage: 'probara vis recording-links list [options]',
    summary: 'List the recording links you manage, newest first',
    details: [
      'Prints one line per link: its ULID, state, mode, how many recordings it received and its title. You manage the links you created; owners and admins manage every link of the organization. The log line after the list says which page this is and how many links match: pass --page for the next one.',
    ],
    example: ['probara vis recording-links list --state active'],
    environment: [VIS_TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'vis recording-links get': {
    usage: 'probara vis recording-links get [options] <id>',
    summary: 'Show one recording link and its URL',
    details: [
      'The id is the ULID of the link. A link you do not manage is not found (exit 1). A revoked link has no URL.',
    ],
    example: ['probara vis recording-links get 01KC0000000000000000000R1K'],
    environment: [VIS_TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'vis recording-links create': {
    usage: 'probara vis recording-links create [options] --title <text>',
    summary: 'Create a recording link: a URL anyone records their screen with, no account needed',
    details: [
      'What someone records with the link arrives as a Vis of the organization, titled --title, in --folder, with --reference kept on it. A one-time link stops working after the first recording; any link stops at --expires, and for good once revoked. On success stdout holds the ULID and the URL of the link, separated by a space.',
      'Each link created counts against the recording links per month of the plan, deleted ones included: past them, Probara refuses the link (exit 1).',
    ],
    example: [
      'probara vis recording-links create --title "Checkout bug" --reference SUP-1042 \\',
      '  --expires 2026-12-31T18:00:00Z',
    ],
    environment: [VIS_TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'vis recording-links update': {
    usage: 'probara vis recording-links update [options] <id>',
    summary: 'Change the title, folder, reference, expiry or microphone of a recording link',
    details: [
      'The id is the ULID of the link. Only the options given change; the mode of a link never does. A revoked link cannot change (exit 1).',
    ],
    example: ['probara vis recording-links update 01KC0000000000000000000R1K --expires never'],
    environment: [VIS_TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'vis recording-links revoke': {
    usage: 'probara vis recording-links revoke [options] <id>',
    summary: 'Stop a recording link for good',
    details: [
      'The id is the ULID of the link. Its URL stops working at once and never works again; the Vises it received are kept. The command shows the link and asks for a confirmation on the terminal; --yes revokes without asking, and is required when stdin is not a terminal (in CI).',
    ],
    example: ['probara vis recording-links revoke 01KC0000000000000000000R1K --yes'],
    environment: [VIS_TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
  'vis recording-links delete': {
    usage: 'probara vis recording-links delete [options] <id>',
    summary: 'Delete a recording link; the Vises it received are kept',
    details: [
      'The id is the ULID of the link. Its URL stops working, and the link is gone from the list. The command shows the link and asks for a confirmation on the terminal; --yes deletes without asking, and is required when stdin is not a terminal (in CI).',
    ],
    example: ['probara vis recording-links delete 01KC0000000000000000000R1K --yes'],
    environment: [VIS_TOKEN_VARIABLE, ENABLED_VARIABLE],
  },
};

const WIDTH = 100;
const INDENT = '  ';

/** `text` wrapped at {@link WIDTH}, each line starting with `indent`. */
function wrap(text: string, indent: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter((part) => part !== '')) {
    if (line !== '' && indent.length + line.length + 1 + word.length > WIDTH) {
      lines.push(`${indent}${line}`);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  if (line !== '') lines.push(`${indent}${line}`);
  return lines;
}

/** How an option is written in the help: `-h, --help`, `--[no-]close-run`, `--tag <tag>`. */
export function optionLabel(option: OptionSpec): string {
  const long =
    option.negation === 'both'
      ? `--[no-]${option.name}`
      : option.negation === 'only'
        ? `--no-${option.name}`
        : `--${option.name}`;
  const flags = option.short === undefined ? long : `-${option.short}, ${long}`;
  return option.value === undefined ? flags : `${flags} ${option.value}`;
}

/** Rows of `[label, description, ...detail lines]`, the descriptions aligned in one column. */
function table(rows: readonly (readonly string[])[]): string[] {
  const column = Math.max(...rows.map(([label = '']) => label.length)) + 2;
  const pad = ' '.repeat(INDENT.length + column);
  return rows.flatMap(([label = '', description = '', ...details]) => {
    const [first = '', ...rest] = wrap(description, pad);
    return [
      `${INDENT}${label.padEnd(column)}${first.slice(pad.length)}`,
      ...rest,
      ...details.flatMap((detail) => wrap(detail, pad)),
    ];
  });
}

function optionRow(option: OptionSpec, command: CommandName): string[] {
  const described = describeOption(option, command);
  const description =
    option.type === 'list'
      ? `${described} (repeatable, or comma-separated)`
      : option.type === 'repeatable'
        ? `${described} (repeatable)`
        : described;
  return [
    optionLabel(option),
    description,
    ...(option.choices === undefined ? [] : [`values: ${option.choices.join(', ')}`]),
    ...(option.env === undefined ? [] : [`env: ${option.env}`]),
    ...(option.default === undefined ? [] : [`default: ${option.default}`]),
  ];
}

/** The exit codes of a command: those of every command, and those of its own. */
function exitCodeRows(command: CommandName): [string, string][] {
  return EXIT_CODES.filter(
    ({ commands }) => commands === undefined || commands.includes(command),
  ).map(({ code, meaning }) => [String(code), meaning]);
}

/** The help of one command. */
export function commandHelp(command: CommandName): string {
  const help = COMMAND_HELP[command];
  return [
    `Usage: ${help.usage}`,
    '',
    `${help.summary}.`,
    ...help.details.flatMap((paragraph) => ['', ...wrap(paragraph, '')]),
    ...(help.example === undefined
      ? []
      : ['', 'Example:', ...help.example.map((line) => `${INDENT}${line}`)]),
    '',
    'Options:',
    ...table(optionsOf(command).map((option) => optionRow(option, command))),
    '',
    'Environment:',
    ...table(help.environment),
    '',
    'Exit codes:',
    ...table(exitCodeRows(command)),
    '',
  ].join('\n');
}

/**
 * The help of a group of commands, such as `probara import`, with the groups inside it as one row
 * each (`[name, summary]`).
 */
export function groupHelp(
  group: string,
  commands: readonly CommandName[],
  subgroups: readonly (readonly [string, string])[] = [],
): string {
  return [
    `Usage: probara ${group} <${group === 'import' ? 'format' : 'command'}> [options]`,
    '',
    'Commands:',
    ...table([
      ...commands.map((command) => {
        const { usage, summary } = COMMAND_HELP[command];
        return [usage.replace(`probara ${group} `, '').replace(' [options]', ''), summary];
      }),
      ...subgroups.map(([name, summary]) => [`${name} <command>`, summary]),
    ]),
    '',
    `Run "probara ${group} <${group === 'import' ? 'format' : 'command'}> --help" for its options.`,
    '',
  ].join('\n');
}

/** The help of `probara` itself, with the groups inside groups as one row each (`[name, summary]`). */
export function rootHelp(
  commands: readonly CommandName[],
  subgroups: readonly (readonly [string, string])[] = [],
): string {
  return [
    'Usage: probara <command> [options]',
    '',
    'Report automated test results to Probara from any CI, and manage Probara Vises.',
    '',
    'Commands:',
    ...table([
      ...commands.map((command) => {
        const { usage, summary } = COMMAND_HELP[command];
        return [usage.replace('probara ', '').replace(' [options]', ''), summary];
      }),
      ...subgroups.map(([name, summary]) => [`${name} <command>`, summary]),
    ]),
    '',
    'Options:',
    ...table([
      ['-h, --help', 'Show the help (of a command, after its name)'],
      ['--version', 'Print the version'],
    ]),
    '',
    'Run "probara <command> --help" for the options of a command.',
    '',
  ].join('\n');
}
