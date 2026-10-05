<p align="center">
  <a href="https://probara.net"><img src="https://raw.githubusercontent.com/cynch-me/probara-sdk/main/.github/assets/probara-mark.png" alt="Probara" width="120"></a>
</p>

<h1 align="center">@probara/core</h1>

<p align="center">The reporting engine behind every Probara adapter.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@probara/core"><img src="https://img.shields.io/npm/v/@probara/core?style=flat-square&color=5b3fd6&logo=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@probara/core"><img src="https://img.shields.io/npm/dm/@probara/core?style=flat-square&color=5b3fd6" alt="npm downloads"></a>
  <a href="https://github.com/cynch-me/probara-sdk/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/cynch-me/probara-sdk/ci.yml?branch=main&style=flat-square&label=CI&logo=githubactions&logoColor=white" alt="CI status"></a>
  <a href="https://github.com/cynch-me/probara-sdk/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-5b3fd6?style=flat-square" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.12-5b3fd6?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22.12 or later">
</p>

<p align="center">
  <a href="#quick-path"><b>Quick path</b></a>
  ·
  <a href="#writing-an-adapter"><b>Writing an adapter</b></a>
  ·
  <a href="#api"><b>API</b></a>
  ·
  <a href="https://probara.net"><b>Probara</b></a>
  ·
  <a href="https://github.com/cynch-me/probara-sdk"><b>Probara SDK</b></a>
</p>

The base library every Probara adapter builds on. You create a reporter, hand it each finished
test, and call `complete()`. Core takes care of the rest:

- reading configuration from options and `PROBARA_*` variables,
- detecting the CI build,
- building the automation key,
- keeping every field inside the API limits,
- chunking, retries, and the final summary.

A reporting failure never throws into the test framework.

| At a glance          |                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------ |
| For                  | Authors of Probara adapters: reporters for other frameworks, importers, custom tools |
| You call             | `createReporter()`, `addResult()` for each test, `await complete()`                  |
| Core handles         | Config, CI detection, automation keys, API limits, chunking, retries, the summary    |
| Never                | Throws into the test framework, or logs the token                                    |
| Runtime dependencies | None                                                                                 |

## Install

```bash
npm i @probara/core
```

## Quick path

1. Set `PROBARA_API_TOKEN` and `PROBARA_PROJECT` in CI. Without them the reporter stays off and
   quiet. The token is an app token: in Probara, an admin or owner opens **Integrations**, picks
   the card of the tool that reports (**JUnit XML** for the CLI, **Playwright** for the Playwright
   reporter) and creates one (the secret starts with `probara_app_` and is shown once). Reporting from CI needs a paid plan; on the free plan Probara answers `403 forbidden`.
2. Call `createReporter()` when the run starts, `addResult()` for each test, and
   `await complete()` at the end.
3. Look for the log line `[probara] Recorded 120 results (3 new cases, 2 unmatched) in R-12 (closed): <url>`.

## Writing an adapter

An adapter hands each finished test to `addResult()` as a `TestResultInput` and calls `complete()`
once the run ends. The official Playwright reporter,
[`@probara/playwright-reporter`](https://github.com/cynch-me/probara-sdk/blob/main/packages/playwright-reporter/README.md),
is a complete adapter to learn from: it builds the same automation keys as the CLI's JUnit import,
maps Playwright's statuses, and hands over every attachment.

The reporter API:

| Member                     | What it does                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                  | `false` when reporting is off, not configured, or misconfigured                                                                                                       |
| `acceptsResults`           | Whether `addResult` keeps results: `enabled`, or a results file while reporting is off ([results file](#results-file))                                                |
| `addResult(input)`         | Queues one test. Synchronous, never throws. Invalid input is counted.                                                                                                 |
| `complete()`               | Sends what is left and resolves the summary. Never rejects. Same promise on every call.                                                                               |
| `unsentResults(projectId)` | Once `complete()` settled, the results of that project that did not reach Probara, as given, one per case: to send them again into another run (never in the summary) |

### `TestResultInput`

| Field            | Required | Notes                                                                                       |
| ---------------- | -------- | ------------------------------------------------------------------------------------------- |
| `identity`       | yes      | `{ file?, titlePath, parameters? }`, which builds the automation key                        |
| `status`         | yes      | `passed`, `failed`, `skipped` or `blocked`                                                  |
| `caseDisplayId`  | no       | Explicit link such as `PRB-12`. The server treats it as authoritative.                      |
| `caseDisplayIds` | no       | More links: the result is sent once per case (see [several cases](#one-test-several-cases)) |
| `automationKey`  | no       | Replaces the built key (see below)                                                          |
| `title`          | no       | Title of a created case. Defaults to the last title segment.                                |
| `suitePath`      | no       | Suites of a created case. Defaults to the file, then the describes.                         |
| `durationMs`     | no       | Rounded, never negative                                                                     |
| `startedAt`      | no       | `Date`, ISO string or epoch ms, sent as `executedAt` (see below)                            |
| `error`          | no       | A string or `{ message?, stack? }`, or a list of them in order, written into the notes      |
| `comment`        | no       | A comment, written first in the notes, before the error                                     |
| `notes`          | no       | Extra text, added after the error                                                           |
| `attachments`    | no       | Files `{ name?, fileName?, contentType?, path?, body? }` (see [Attachments](#attachments))  |
| `parameters`     | no       | `{ browser: 'chromium' }`: shown with the result, never part of the key                     |
| `steps`          | no       | The step tree (see [steps](#steps-parameters-and-the-created-case))                         |
| `case`           | no       | `{ description?, tags?, fields?, steps? }` of a case the report creates                     |
| `links`          | no       | `[{ url, name? }]`: an issue, a TMS page, a build log (see [links](#links))                 |

#### Steps, parameters and the created case

`steps` is a tree of `{ action, status, durationMs?, error?, expected?, data?, steps?, attachments? }`:
what the execution did, shown under the result in Probara. `error` is written like the result's
(message, then stack); `attachments` are files of that step, uploaded with the result's (see
[Attachments](#attachments)).

`case` is what a case starts with when the report creates it: a `description`, `tags` (unknown
ones are added to the organization's tags), `fields` by name (`priority`, `severity`, `type`,
`layer`, `behavior`, `status`, `preconditions`, `postconditions`, `is_flaky`, or the title of a
custom field; option values by name) and `steps` (`{ action, expected?, data? }`). Probara applies
it only when the entry creates the case: an existing case is never changed. A field or value it
cannot resolve is skipped, and listed in the summary's `warnings`.

```ts
reporter.addResult({
  identity,
  status: 'failed',
  parameters: { browser: 'chromium' },
  steps: [
    { action: 'Open the cart', status: 'passed', durationMs: 120 },
    { action: 'Pay', status: 'failed', error: { message: 'Card declined' } },
  ],
  case: { tags: ['smoke'], fields: { priority: 'high' }, steps: [{ action: 'Pay' }] },
});
```

#### Links

`links` are shown with the result in Probara, in order: `{ url, name? }`, where `url` is an
absolute `http:` or `https:` URL of at most 2048 characters and `name` the text shown for it (cut
to 255). Core checks them like Probara does: a link with another scheme (`javascript:`, `data:`,
`file:`), a relative URL or a name that is not a string is dropped, like the links beyond the
first 20, with a warning; the result is sent anyway. The results file keeps them, and
`probara import results` sends them.

```ts
reporter.addResult({
  identity,
  status: 'failed',
  links: [
    { url: 'https://jira.example.com/browse/PRB-7', name: 'PRB-7' },
    { url: 'https://ci.example.com/build/412' },
  ],
});
```

#### One test, several cases

A test that covers several cases passes them all: `caseDisplayId`, then every id of
`caseDisplayIds`, trimmed, once each (blank ones are ignored). The reporter sends one entry per
case, one after another, each with the same automation key, status, duration and notes, and
uploads the attachments to the result of each case. Each entry counts towards `chunkSize` and the
summary like any other result.

```ts
reporter.addResult({ identity, status: 'passed', caseDisplayIds: ['PRB-12', 'PRB-13'] });
// sends two entries with the same key: one for PRB-12, one for PRB-13
```

`fanOutByCase(input)` gives the same split, for an adapter that counts or prints what is sent.
`toReportEntry` converts one case at a time: it throws a `TypeError` for an input that links
several cases.

A `startedAt` string without a UTC offset (`2026-09-29T14:05:00`) is parsed as the host's local
time, so the same string means another instant on a machine in another time zone. Pass a `Date`
or epoch ms, or a string with `Z` or an offset.

### The adapter's own bookkeeping

What the official adapters do around `createReporter`, so a new one behaves the same:

| Export                                                        | What it does                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveAdapterSetup(options, context)`                       | The `createReporter` options of a run: `rootDir` defaulting to the framework's, the adapter's `clientName`, a logger on stderr (or the context's `logStream`) at the resolved `debug`, and the adapter's `adapterProblems`; with the `projectCodes` and `statusRules` |
| `createAdapterSession({ logger, statusRules, projectCodes })` | `count(input, test)` for each result handed to `addResult`, `countIgnored()` for each `probara.ignore()`, `warnOnce(message, where)`, and `summaryLine()`                                                                                                             |
| `linksOnlyUnlistedProjects(input, projectCodes)`              | Whether core will drop the result: every case it links belongs to a project that is not listed                                                                                                                                                                        |
| `logAdapterError(message, options, logger?, stream?)`         | One error line without the token of the options or their environment, even before the setup is known, on `stream` (`stderr` by default) without a logger. Never throws.                                                                                               |

`summaryLine()` is the line to log at info before `complete()`, while the reporter is `enabled`
(core logs the results file it writes instead):
`Sending 3 results of 2 tests (1 passed, 1 failed, 0 skipped, 1 blocked); 1 left out by statusFilter; 1 ignored with probara.ignore(); 1 linked only to cases of unlisted projects`.
It counts the statuses core sends (after `statusMapping`), every attempt of a test as one test, and
says nothing when nothing was counted. `warnOnce` warns about a problem the first time, `(first seen
in "pays"; repeats are logged at debug)`, then logs it at debug.

### What a test says about itself (`probara.*`)

The official adapters give tests the same helpers (`probara.id()`, `title()`, `suite()`,
`comment()`, `ignore()`, `parameters()`, `tags()`, `fields()`, `step()`, and, where the adapter
offers them, `link()` and `issue()`). Each call is one
`MetadataMessage` (`{ type: 'title', value: 'Pays with a card' }`), which the adapter carries as
JSON from the test to the reporter however its framework allows. `readMetadataMessages(messages)`
merges the messages of one attempt, in call order, into its `AttemptMetadata`:

| Message      | Merge rule                                                                        |
| ------------ | --------------------------------------------------------------------------------- |
| `id`         | Case id lists (`'PRB-1, PRB-2'`), accumulated into `ids`, once each               |
| `title`      | The last non-blank one wins                                                       |
| `suite`      | The last non-empty list wins (`suitePath`); blank levels are dropped              |
| `comment`    | The last non-blank one wins                                                       |
| `ignore`     | `ignored: true`: the attempt is not reported                                      |
| `parameters` | Merged by name, the last value wins                                               |
| `tags`       | Accumulated, once each, in the order of their first call; blank ones are dropped  |
| `fields`     | Merged by name, the last value wins                                               |
| `step`       | A case step `{ action, expected?, data? }` under the reference (`ref`) it carries |
| `link`       | `{ url, name? }`, accumulated into `links` in call order                          |
| `issue`      | `{ id }`, accumulated into `links` in call order as `{ issue: id }`               |

A malformed message (not an object, an unknown type, a value of the wrong shape, a `__proto__`
name) changes nothing and adds a problem, `Ignored malformed probara metadata (type "title")`;
pass `undefined` for a message whose JSON could not be parsed. `applyMetadataMessage(metadata,
message)` merges one message and says whether it was well formed, for an adapter with messages of
its own. `CASE_ANNOTATION` is `probara_case`, the Playwright annotation and JUnit property that
link a test to cases.

`createMetadataRecorder(sink, warn)` gives an adapter the checks of those helpers, so every adapter
accepts the same arguments and warns with the same words. Each call becomes one well-formed
message handed to `sink`, the adapter's transport; a wrong argument, or a `sink` that throws, is a
warning through `warn` instead (`probara.tags() takes strings`), never an exception in the test.
Numbers and booleans of `parameters()` and `fields()` become strings, and blank tags and suite
titles are dropped with a warning. `link(url, name?)` sends only an absolute `http(s)` URL of at
most 2048 characters (`probara.link() takes an absolute http(s) URL of at most 2048 characters`),
and `issue(id)` a non-blank id. `caseStep(action, expected, data)` only checks a case step: the
adapter numbers the steps of an attempt and sends each `step` message with its `ref`.

```ts
const recorder = createMetadataRecorder(
  (message) => channel.write(JSON.stringify(message)), // how your adapter reaches its reporter
  (warning) => console.warn(`[probara] ${warning}`),
);
recorder.tags('smoke', 'checkout'); // sends { type: 'tags', value: ['smoke', 'checkout'] }
```

Once an attempt ends, `metadataResultFields(metadata, { caseIds, caseSteps, issueUrlTemplate,
warn })` gives the parts of its `TestResultInput` the metadata decides, to spread into it:
`caseDisplayId` or `caseDisplayIds`, `title`, `suitePath`, `comment`, `parameters`, `case` and
`links`, each left out when nothing set it. Each issue id becomes a link through
`issueUrlTemplate`: every `%s` of the template is the URL-encoded id, and the id is the link's
name (`https://jira.example.com/browse/%s` and `PRB-7` give
`{ url: 'https://jira.example.com/browse/PRB-7', name: 'PRB-7' }`, as `issueLink(id, template)`
does). Without a template, the issues are dropped and `warn` says so once per attempt
(`Dropped the issues of probara.issue(): no issueUrlTemplate turns their ids into links`); pass
the adapter session's `warnOnce`.

An adapter with `probara.issue()` takes the template as its own setting, such as
`issueUrlTemplate` and `PROBARA_ISSUE_URL_TEMPLATE`, and reads it with
`resolveUrlTemplateSetting(option, label, variable, env)`: the option, else the variable, trimmed.
A value that is not an absolute `http(s)` URL with `%s` is a `problem`
(`issueUrlTemplate must be an http(s) URL with %s where the issue id goes`) to pass as
`adapterProblems`, like `resolveBooleanSetting`'s.
`linkedCaseIds(explicit, titleIds)` builds `caseIds` like the official adapters: the ids of the
explicit lists first (`probara_case` annotations, `probara.id()`), then the ids found in the titles,
each once. `caseOf(metadata, caseSteps)` alone is the created case: the tags, the fields (a
`description` field, in any case, becomes the case description) and the case steps.

```ts
const { metadata, problems } = readMetadataMessages(messagesOfThisAttempt);
const titled = extractTitlePathCaseIds(titlePath, projectCodes);
reporter.addResult({
  identity: { file, titlePath: titled.titlePath },
  status,
  ...metadataResultFields(metadata, { caseIds: linkedCaseIds(metadata.ids, titled.ids) }),
});
```

### Carrying the lines of a test to the reporter

The adapters whose helpers run **inside** the test framework's own process (the Jest and Cypress
reporters) do not carry the `probara.*` messages through the framework; each test writes them over a
transport of its own and the reporter reads them back. Core owns the protocol both speak, so a new
adapter writes the lines once and reads them with the same reader:

- **`ChannelLine`** is one line of JSON: a `message` (a `MetadataMessage`, see above), a
  `step-start`, a `step-end`, an `attachment`, a `warning`, a `setup` or a `selection`. The four
  first ones carry an `AttemptRef` (`file`, `test`, `attempt`) — every line of a test names the
  attempt it belongs to, which is how the reporter matches it to its result whatever the order of the
  framework's events. The last three name no attempt: a warning names the file and the test it was
  given in, a setup line the file it ran in, a selection line what it did of `runCasesOnly`.
- **`attemptKey(file, test, attempt)`** is the same string for one attempt in the test process and in
  the reporter: the only link between a line and its result. Two tests of one file with the same
  full name share it, and the reporter then gives neither what their helpers said.
- **`RunSelection`** is what the reporter tells its setup file of the run to run: the run, the
  automation keys and display ids of its cases, the `projectCodes` read from titles,
  `keyIncludesFile` and `rootDir` — how the adapter keys a test. **`parseSelection(value)`** reads it
  back (and answers `undefined` for anything malformed), and **`SELECTION_FAILURES`** lists why a
  setup file could not skip the tests that match no case (`no-hook`, `no-circus`, `failed`).
- **`detailsOf(lines, dir)`** gives the **`AttemptDetails`** of one attempt from its lines, in the
  order they were written: `metadata` and `problems` (through `readMetadataMessages`), `steps`
  (nested as they started, with the files attached inside each), `caseSteps` (the outermost steps,
  in order) and `attachments` (the files attached outside any step). A step whose commands failed
  before it ended is `failed` with `The step had not finished when the test ended`. `dir` is the
  folder that holds the copies the attachment lines name, in its `files/` subfolder: a copy name is
  read as a name, never as a path, and each file is `temporary` (a results file keeps its own copy).
  It takes **every** `ChannelLine` the transport received: the lines about the file or the run
  (`warning`, `setup`, `selection`) belong to no attempt and are left out, so an adapter hands it a
  whole transport without filtering.

```ts
// In the test process (or the browser), one line per helper call:
channel.appendLine({ file, test, attempt: 1, type: 'message', message });
// In the reporter, once the attempt is over:
const details = detailsOf(linesOfThatAttempt, channelDir);
```

The directory, the settings file and the writer stay with the adapter: they are its own files and its
own variables (`@probara/jest-reporter` keeps them in `src/channel.ts`, which loads inside Jest's
test sandbox, where the tests in its `test/package.test.ts` forbid any module of core).

### ES modules, CommonJS and the `metadata` and `browser` entries

Core ships two builds of the same code: ES modules for `import`, and CommonJS for `require()`,
for frameworks that load reporters and test code with `require` (Jest cannot load ES modules
without `--experimental-vm-modules`). Node picks the build by how the package is loaded:

| Entry                    | `import`                 | `require()`                  |
| ------------------------ | ------------------------ | ---------------------------- |
| `@probara/core`          | `dist/index.js`          | `dist/cjs/index.js`          |
| `@probara/core/metadata` | `dist/metadata-entry.js` | `dist/cjs/metadata-entry.js` |
| `@probara/core/browser`  | `dist/browser.js`        | `dist/cjs/browser.js`        |

`@probara/core/metadata` is the part a test process needs to speak about its test: the
`probara.*` model (`readMetadataMessages`, `applyMetadataMessage`, `emptyMetadata`,
`CASE_ANNOTATION`), `createMetadataRecorder`, the case ids in titles (`extractCaseIds`,
`extractTitlePathCaseIds`, `parseCaseDisplayId`, `parseCaseIdList`) and `buildAutomationKey`. It
loads nothing that reports, reads the configuration or reaches the network, so the helpers an
adapter runs inside the test framework's module registry stay small. The same functions are
exported by `@probara/core`.

`@probara/core/browser` is that entry for code a framework runs **in a browser**, where no Node
built-in exists (the support file of a Cypress run, for instance). It holds the same metadata
model, `createMetadataRecorder`, the case ids of titles and the transport protocol — the kinds of
`ChannelLine`, `attemptKey`, `parseSelection`, `SELECTION_FAILURES` and their types — **without
`buildAutomationKey`**, which hashes with `node:crypto` and normalizes a path with `node:path`. A
test that needs the key builds it in the reporter's own process, where Node is there. The entry
loads eight small modules and nothing that reports, reads the configuration or reaches the
network; `src/browser.test.ts` walks the whole graph from it and fails on any `node:` specifier.

Core keeps no state in its modules: every reporter, session and recorder holds its own. A process
that loads both builds (an ES module adapter next to a CommonJS one) gets two copies of the code,
never two views of shared state. Only `instanceof` differs across the copies: compare a
`ProbaraApiError` by its `name` if a value may come from the other build.

### The summary

`complete()` resolves a `ReportSummary`:

| Field              | Meaning                                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`           | `disabled`, `empty`, `completed`, `partial` or `failed`                                                                                                                                            |
| `run`              | `{ ulid, displayId, state, url }` once a report was recorded                                                                                                                                       |
| `recorded`         | Results recorded in the run                                                                                                                                                                        |
| `created`          | Cases the reports created                                                                                                                                                                          |
| `unmatched`        | `{ reason, automationKey?, caseDisplayId?, title? }` for each result that recorded nothing                                                                                                         |
| `invalid`          | Inputs `addResult` could not convert (adapter bugs). These are never sent.                                                                                                                         |
| `filtered`         | Results left out by `statusFilter` ([statuses](#status-mapping-and-filter)), one per case. Never sent.                                                                                             |
| `dropped`          | Results linked to a case of a project that is not listed ([several projects](#several-projects)), one per case. Never sent.                                                                        |
| `notSent`          | Results that did not reach Probara: the failed report and every one after it                                                                                                                       |
| `errors`           | `{ message, code?, status?, retryable? }` for config problems, failed reports and a failed close                                                                                                   |
| `attachments`      | `{ uploaded, skipped, failed }`: files of the results (see [Attachments](#attachments))                                                                                                            |
| `attachmentErrors` | `{ message, code?, status?, retryable? }` for failed stage and commit requests                                                                                                                     |
| `warnings`         | What Probara skipped without failing a report, such as a case field it could not resolve (`Unknown field "Sevrity" was skipped`): once each, logged as they arrive                                 |
| `projects`         | One entry per project results went to, the configured one first: `{ projectId, status, run?, recorded, created, unmatched, notSent, errors, attachments }` ([several projects](#several-projects)) |
| `resultsFile`      | `{ path, results, error? }` once a results file was written ([results file](#results-file))                                                                                                        |

An error with `retryable: true` is an answer Probara asks to retry (429, 5xx, a 409 with
`Retry-After` for a request still in flight) whose retries ran out: that request may still be
recorded. `retryable: false` is a refusal, such as a 409 `conflict` of a closed run or a 404.

With several projects, the counts above add up every project, `run` is the configured project's,
and each message of `errors` and `warnings` starts with its project (`WEB: ...`).

## Configuration

Precedence is **options > environment > defaults**. An option set to `undefined` never overrides
the environment. Booleans accept `true/1/yes/on` and `false/0/no/off`.

| Option                   | Variable                                                | Default                                                                              |
| ------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `enabled`                | `PROBARA_ENABLED`                                       | on (`false` turns reporting off)                                                     |
| `apiToken`               | `PROBARA_API_TOKEN`                                     | none (required). An app token: see the quick path.                                   |
| `projectId`              | `PROBARA_PROJECT`                                       | none (required). The project code (capital letters and digits), such as `SHOP`.      |
| `baseUrl`                | `PROBARA_BASE_URL`                                      | `https://app.probara.net`                                                            |
| `run.ulid`               | `PROBARA_RUN_ULID`                                      | none, so core creates a run                                                          |
| `run.name`               | `PROBARA_RUN_NAME`                                      | the CI build name (`CI #42`), else `Automated run <date> <time> UTC`                 |
| `run.description`        | `PROBARA_RUN_DESCRIPTION`                               | none                                                                                 |
| `run.environmentId`      | `PROBARA_ENVIRONMENT_ID`                                | none                                                                                 |
| `run.environment`        | `PROBARA_ENVIRONMENT`                                   | none. By name: created in the project when none matches.                             |
| `run.milestoneId`        | `PROBARA_MILESTONE_ID`                                  | none                                                                                 |
| `run.milestone`          | `PROBARA_MILESTONE`                                     | none. A display id (`M-3`) or the exact name.                                        |
| `run.plan`               | `PROBARA_PLAN`                                          | none. A display id (`PLAN-2`) or the exact name: the run starts with its cases.      |
| `run.configurationUlids` | `PROBARA_CONFIGURATION_ULIDS`                           | none (comma-separated)                                                               |
| `run.configurations`     | `PROBARA_CONFIGURATIONS`                                | none. `[{ group, name }]`, or `Browser=Chrome,OS=Linux`, each group once.            |
| `run.tags`               | `PROBARA_RUN_TAGS`                                      | none (comma-separated)                                                               |
| `source`                 | `PROBARA_BRANCH`, `PROBARA_COMMIT`, `PROBARA_BUILD_URL` | detected from CI. A blank field is unset. `false` sends none.                        |
| `createMissingCases`     | `PROBARA_CREATE_MISSING_CASES`                          | `true`                                                                               |
| `suiteUlid`              | `PROBARA_SUITE_ULID`                                    | the project root                                                                     |
| `closeRun`               | `PROBARA_CLOSE_RUN`                                     | `true` for a created run, `false` for a reused one                                   |
| `closeRuns`              | none                                                    | none. `{ SHOP: true, WEB: false }`: per project, when `closeRun` is unset.           |
| `debug`                  | `PROBARA_DEBUG`                                         | `false`                                                                              |
| `rootDir`                | none                                                    | `process.cwd()`. File paths in keys are relative to it.                              |
| `clientName`             | none                                                    | none. Sent first in the User-Agent.                                                  |
| `chunkSize`              | none                                                    | `500` (1..500)                                                                       |
| `timeoutMs`              | none                                                    | `30000` per attempt, body included (1..600000)                                       |
| `maxRetries`             | none                                                    | `4` (0..10)                                                                          |
| `uploadAttachments`      | `PROBARA_UPLOAD_ATTACHMENTS`                            | `true`. `false` uploads no attachment.                                               |
| `attachmentConcurrency`  | none                                                    | `2` results uploading at a time (1..8)                                               |
| `statusMapping`          | `PROBARA_STATUS_MAPPING`                                | none ([statuses](#status-mapping-and-filter))                                        |
| `statusFilter`           | `PROBARA_STATUS_FILTER`                                 | none ([statuses](#status-mapping-and-filter))                                        |
| `projects`               | `PROBARA_PROJECTS`                                      | none (comma-separated project codes: [several projects](#several-projects))          |
| `run.ulids`              | `PROBARA_RUN_ULIDS`                                     | none (`WEB=<ulid>,API=<ulid>`: [several projects](#several-projects))                |
| `resultsFile`            | `PROBARA_RESULTS_FILE`                                  | none ([results file](#results-file))                                                 |
| `assignFailedTo`         | `PROBARA_ASSIGN_FAILED_TO`                              | none (comma-separated emails: [assigning failed results](#assigning-failed-results)) |

The options for creating a run (`run.name`, `run.environmentId`, and the others) are ignored, with
a warning, when `run.ulid` is set.

The environment, milestone and configurations of a new run take a ULID or a name, never both: set
`run.environmentId` or `run.environment`, `run.milestoneId` or `run.milestone`,
`run.configurationUlids` or `run.configurations` (both set is a problem that turns reporting off).
Names are what an app token can use: it cannot look ULIDs up. Probara refuses an unknown milestone,
plan or configuration with 422, naming the field, and records nothing; an unknown environment name
creates the environment.

What happens with each setup:

| Setup                                        | Result                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| No token and no project, or `enabled: false` | Disabled. Nothing is sent, and core logs at debug only.                        |
| Only one of them, or an invalid value        | Reporting is off. Each problem is logged at error, and the status is `failed`. |
| Both valid                                   | Enabled                                                                        |

An option of the wrong type (such as `run.tags: 'nightly'` instead of a list) is an invalid value:
it turns reporting off with a problem, and never throws. A `source` field that is not a string is
only dropped, with a warning, like any other invalid source field.

### Assigning failed results

`assignFailedTo` (`PROBARA_ASSIGN_FAILED_TO=ana@example.com,bo@example.com`) names up to 20
members of the organization by email, trimmed and once each ignoring case. Every report of the
run, each chunk included, asks Probara to assign each run case it leaves failed and without an
assignee to one of them, in turn, starting again with the first in every report; a run case that
already has an assignee keeps it. A value that is not an email, or more than 20 emails, is a problem
that turns reporting off. An email that matches no member who can be assigned in the project is
not an error: Probara counts them in a warning, logged like its others
(`Probara warned: assignFailedTo: 1 of 2 emails did not match a member who can be assigned in this project`),
and never names them. The results file keeps the emails.

### Several projects

A result goes to the project of the case it links: `WEB-3` belongs to `WEB`. By default only the
configured project (`projectId`) is used, and a result linked to a case of any other project is
**dropped**: it would land in the wrong project, where Probara refuses the id. Each project it
happens with is logged once at warn (repeats at debug), and the summary counts them in `dropped`.

List the other projects the reporter may send to in `projects` (`PROBARA_PROJECTS=WEB,API`, codes
of capital letters and digits):

```ts
createReporter({ projectId: 'SHOP', projects: ['WEB', 'API'] });
```

- A result linked to a case of `WEB` goes into a run of `WEB`; a result linked to cases of several
  projects is sent once per case (see [several cases](#one-test-several-cases)), each entry to the
  project of its case, and its attachments go to each of those results.
- A result without a case link, or whose id is malformed, goes to the configured project. Only
  the configured project creates cases (an automation key belongs to one project), and
  `suiteUlid` only applies there.
- Each listed project gets its own run, created with the first result for it (a project without
  results gets no run), with the same name, tags and CI source as the configured project's, and
  closed at the end like any created run (`closeRun` applies to every run). The description and
  the environment by name (`run.environment`, found or created in each project) go with every new
  run. The milestone, plan and configurations (`run.milestone`, `run.plan`,
  `run.configurations`) are planning entities of one project, where an unknown name would refuse
  the whole report, so they only go with the configured project's new run, like
  `run.environmentId`, `run.milestoneId` and `run.configurationUlids` (one warning names them).
  To set them in another project, create its run first and pass it in `run.ulids`.
- Reuse runs per project with `run.ulids` (`PROBARA_RUN_ULIDS=WEB=01J...,API=01J...`): a sharded CI
  job creates one run per project first, and every shard reports into them. The configured
  project's entry counts as `run.ulid` (both set must name the same run); a reused run stays open
  unless `closeRun` is on. An entry of a project that is not listed is ignored with a warning.
  When the configured project's run is reused but a listed project has no entry, each reporter
  (each shard) creates its own run there, and a warning says so.
- A failed report stops only its project: the other projects go on. The summary's `projects`
  holds the run and counts of each project, and the status is `partial` when some project failed.

```bash
export PROBARA_PROJECT=SHOP PROBARA_PROJECTS=WEB
SHOP_RUN=$(npx probara run create)
WEB_RUN=$(npx probara run create --project WEB)
export PROBARA_RUN_ULIDS="SHOP=$SHOP_RUN,WEB=$WEB_RUN"
# ... every shard reports with PROBARA_RUN_ULIDS ...
npx probara run close --run-ulid "$SHOP_RUN"
npx probara run close --run-ulid "$WEB_RUN" --project WEB
```

`createRun` and `closeRun` handle one run of one project: they ignore `projects` and `run.ulids`
(and their variables).

### Status mapping and filter

`statusMapping` changes the status results are sent with, and `statusFilter` leaves results out by
status. The mapping applies first, so the filter sees the mapped status:

```ts
createReporter({
  statusMapping: { failed: 'blocked', skipped: 'passed' }, // from -> to
  statusFilter: ['passed'], // not sent
});
```

The same as variables: `PROBARA_STATUS_MAPPING=failed=blocked,skipped=passed` and
`PROBARA_STATUS_FILTER=passed` (comma-separated, trimmed, in any case). Both take the four statuses
`passed`, `failed`, `skipped` and `blocked`. An unknown status, an entry that is not
`<status>=<status>`, or a status mapped twice is an invalid value: reporting is off with a problem.
Filtered results are counted in the summary's `filtered` (one per case) and logged at info; they
upload no attachment.

`applyStatusRules(status, config)` gives `{ status, filtered }` for one status, for an adapter
that prints what would be sent (the CLI's dry run does).

`createReporter` also accepts test seams: `logger`, `env`, `fetch`, `sleep`, `random` and `now`.

An adapter with settings of its own resolves each boolean one with
`resolveBooleanSetting(option, label, variable, env)`, which follows the rules above (option, then
variable, then the adapter's default; `{ problem }` for a value that is not a boolean). It passes
the problems to `createReporter` as `adapterProblems`: they turn reporting off like core's own
problems, and a disabled or unconfigured reporter stays quiet.

## The automation key (v1)

The key links a test to its Probara case. Every adapter must build the same key for the same test,
so the algorithm is **frozen**. Golden vectors in `src/automation-key.test.ts` pin it: changing
the algorithm would unlink every case already reported.

1. `file`: an absolute path is made relative to `rootDir`, `\` becomes `/`, repeated `/` collapse,
   and a leading `./` is removed.
2. Each `titlePath` segment is NFC-normalized (lone surrogates become U+FFFD), control characters
   and whitespace runs become one space, and the segment is trimmed. Empty segments are dropped.
3. `parameters` are sorted by name (names that normalize alike by value) and appended to the last
   segment:
   `logs in [browser=chromium, locale=es]`.
4. The file and the segments are joined with `>`. Case is preserved.
5. A key over 1024 characters keeps its first 1006, then gets ` #` and 16 hex characters of its
   SHA-256.

Example: `e2e/login.spec.ts > Login > logs in [browser=chromium]`.
`buildAutomationKey(identity, { rootDir })` exposes the same function.

How the server matches each result:

| You send                  | Matching                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| identity only             | By the built key. An unknown key with a title creates the case (unless `createMissingCases: false`). |
| `caseDisplayId: 'PRB-12'` | By display id (authoritative). A case without a key adopts the entry's key.                          |
| `automationKey: '...'`    | By your key instead of the built one. It is normalized and fitted to 1024 characters.                |

### Case ids in titles

A test can name its case in its title (`PRB-12 logs in`). Remove the id before building the key,
so adding or removing it never changes the key, and send it as the case link. Every adapter uses
the same helpers, so a Playwright title and its JUnit testcase name give the same key:

| Helper                                            | What it does                                                                                                                                                                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extractCaseIds(text, projectCode)`               | Finds the `<CODE>-<n>` and `<CODE>_<n>` tokens of that project (case-sensitive, not glued to a letter or digit, optionally in `[]`, `()` or after `@`) and removes them, with the separators and emptied brackets they leave behind |
| `extractTitlePathCaseIds(titlePath, projectCode)` | The same on every segment. A segment left blank is dropped; when only ids are left, the segments are kept as they were.                                                                                                             |
| `parseCaseIdList(value)`                          | The ids of a comma-separated list (a `probara_case` property or annotation), trimmed, once each, as written                                                                                                                         |
| `parseCaseDisplayId(id)`                          | `{ projectCode, number }` of a well-formed display id (`WEB-3`), else `undefined`                                                                                                                                                   |

```ts
extractCaseIds('[PRB-12] logs in (@PRB-13)', 'PRB'); // { text: 'logs in', ids: ['PRB-12', 'PRB-13'] }
extractCaseIds('SHOP-4 logs in', 'PRB'); // { text: 'SHOP-4 logs in', ids: [] }: another project's
parseCaseIdList(' PRB-12, WEB-3 ,PRB-12'); // ['PRB-12', 'WEB-3']
```

Without a project code, `extractCaseIds` finds nothing: only the ids of the project you report
into are read from a title.

## What core normalizes

A single field outside the contract makes the API reject the whole report with 422. Core keeps
every entry inside the limits, so an adapter never causes that. Lone (unpaired) surrogates in any
text field become U+FFFD, so the body is always valid UTF-8:

| Field                 | Limit                                                 | Core does                                                                                                            |
| --------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `status`, `titlePath` | known status, at least one title                      | Otherwise the result is counted as `invalid` and not sent                                                            |
| `automationKey`       | 1..1024, no control characters                        | Normalized. Too long gets a hash suffix. Blank falls back to the built key.                                          |
| `title`               | 1..400                                                | Single line, cut with `…`                                                                                            |
| `suitePath`           | 10 levels of 1..255                                   | Levels past the 10th are merged into the last one with `>`, and each level is cut                                    |
| `notes`               | 4000                                                  | ANSI stripped, error message and stack merged, cut with `…[truncated]`                                               |
| `caseDisplayId`       | 1..64                                                 | Blank or too long is dropped with a warning                                                                          |
| `durationMs`          | finite, 0 or more                                     | Rounded. A value that is not a number is dropped.                                                                    |
| `executedAt`          | RFC 3339 with offset                                  | Sent as UTC ISO. An invalid date is dropped.                                                                         |
| `parameters`          | 20, names 1..100, values 500                          | Trimmed and cut. Blank, repeated and `__proto__` names are dropped with a warning.                                   |
| `steps`               | 200 per result, 10 levels                             | Actions cut to 2000, errors to 4000. Deeper or later steps are dropped with a warning, their files go to the result. |
| `case`                | description 4000, 50 tags of 80, 50 fields, 500 steps | Trimmed and cut. Tags and field names once each, ignoring case. Extra ones are dropped with a warning.               |
| run name              | 1..200                                                | Cut with a warning                                                                                                   |
| run tags              | 50 of 1..80                                           | Deduplicated and cut. Extra tags are dropped with a warning.                                                         |
| configuration ULIDs   | 20, valid ULIDs                                       | Otherwise a config problem                                                                                           |
| `branch`              | 255, no control characters                            | Cleaned. Too long is dropped.                                                                                        |
| `commit`              | 1..64 visible ASCII                                   | Otherwise dropped                                                                                                    |
| `buildUrl`            | http(s), 2048                                         | Otherwise dropped                                                                                                    |

Warnings never echo the value they are about. The limits are exported (`MAX_TITLE_LENGTH`,
`ULID_PATTERN`, and the others).

## Results file

Set `resultsFile` (`PROBARA_RESULTS_FILE=probara-results.json`, relative to the current directory)
and the results that could not be sent are kept in that JSON file at `complete()`: those of a
failed report and every report after it (the server down, the network lost, a run that could not
be created, a project that refused). Send them later with
[`probara import results <paths...>`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#probara-import-results),
into the same runs.

- **Reporting off writes every result.** With `enabled: false` (`PROBARA_ENABLED=false`), without
  a token and a project, or with a configuration that cannot be used, the reporter sends nothing
  and writes every result to the file (`acceptsResults` is then `true`): run the tests anywhere,
  import the file from a machine that holds the token.
- **Nothing to keep, no file.** When every result was sent, nothing is written.
- **Never touches a file already there.** When a results file (another shard's, an earlier run's,
  or any file) is already at that path, the results go to its first free sibling in the same
  folder: `probara-results-2.json`, then `-3`, and so on, each with its own
  `<name>-attachments/` folder. Nothing is merged, and the log names the file written. Writers at
  once never pick the same name: each reserves its number by creating the attachments folder
  exclusively, and a file only takes a name that is still free. Import them all with
  `probara import results 'probara-results*.json'`, which consumes each file: it deletes a file
  once every result in it was sent, and rewrites it with only what is still unsent otherwise. An adapter that sends a results file and writes back what it could not send passes
  `replaceResultsFile: true`, so that file itself is rewritten.
- **Atomic.** Every write goes to a temporary file in the same folder (`.<name>.<uuid>.tmp`, which
  no `probara-results*.json` glob matches), then appears under its name at once: a new file by a
  hard link, which fails when the name is taken (where the file system has no hard links, a rename
  once the name is checked free, which the reserved number keeps from other reporters), a replaced
  file by a rename over it. A reader sees the whole earlier file or the whole new one, never an
  empty or partial file, even when the writer stops halfway.
- **Format, version 1**: `{ "version": 1, "project", "projects"?, "run": {...}, "source"?,
"rootDir", "createMissingCases", "suiteUlid"?, "statusMapping"?, "statusFilter"?, "assignFailedTo"?, "results": [...] }`.
  `run` names the runs results already went to (`ulid`, `ulids`: they go back into them) or the
  run to create (`name`, `tags`, ...), and `close`: whether to close the run of each project
  (`{ "SHOP": true, "WEB": false }`, read back as `closeRuns`), so the runs the reporter created
  are closed and the ones it reused stay open. Each result is the
  `TestResultInput` the adapter gave, one per case, with its own status (`statusMapping` applies
  when the file is sent). An in-memory `body`, and a copy of a `temporary` file (one the adapter
  removes after the run), are written to `<file name>-attachments/` next to the file. The files of
  that folder, those of steps too, are referenced relative to the file, with `/`
  (`probara-results-attachments/1-log`), so the file and its folder can move together (a CI
  artifact another job downloads anywhere); any other file by its absolute path. A `temporary`
  file that cannot be copied is logged at warn, and the file points at it where it is (the
  adapter may remove it after the run). `readResultsFile` resolves a relative path against the
  folder of the file it reads. The token is never written.
- **A results file is trusted input.** Importing one uploads the files it names: an absolute path
  can name any file the importing job can read, so import only results files your own jobs wrote.
  A relative path that leads outside the folder of the file (`../../.ssh/id_rsa`), which no writer
  writes, is left out with a warning.
- The summary's `resultsFile` holds the path of the file written (a sibling when the path was
  taken) and the number of results in it. A file that cannot be written is logged at error, with
  the reason in `resultsFile.error`; it never throws.
- `readResultsFile(path)` reads a file back: `{ ok: true, options, results, warnings }` (the
  options it describes, to resolve under your own; `warnings` name the attachments left out) or
  `{ ok: false, error }`.

## Chunking, closing and sharding

- Results go out in reports of `chunkSize` (500), strictly one after another, in the order they
  were added. The order matters because the run case keeps the last outcome. A report also stays
  within the totals of the server: at most 10000 result steps, 10000 case steps and 1000 case tags;
  the next result starts a new report rather than exceed one.
- The first report creates the run. Later reports reuse its `ulid`.
- Only the **last** report carries `close: closeRun`, so the run closes after everything is in.
  With attachments, the run is closed on its own after the uploads instead (see
  [Attachments](#attachments)).
- Each report gets its own `Idempotency-Key`. Retries reuse it, so a retried report is replayed,
  never recorded twice.

### Sharded CI

Shards share one run in three steps: create the run once with `createRun`, give its ULID to every
shard as `PROBARA_RUN_ULID`, and close it once with `closeRun`, in a final job that runs after
every shard:

```bash
# 1. A first job, before the shards: writes the ULID of the new run to probara-run-ulid
#    (the log lines go to the console, so the file holds only the ULID)
node --input-type=module -e "
import { writeFileSync } from 'node:fs';
import { createRun } from '@probara/core';
const summary = await createRun();
if (summary.status === 'created') writeFileSync('probara-run-ulid', summary.run.ulid);
else if (summary.status === 'disabled') console.warn('Probara reporting is disabled: no run was created and probara-run-ulid was not written');
else process.exitCode = 1;
"

# 2. Every shard, with the ULID of step 1 (pass the file's content on as a job output)
PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 <your test command> --shard=1/4

# 3. The final job, after the last shard (same PROBARA_API_TOKEN, PROBARA_PROJECT, PROBARA_RUN_ULID)
node --input-type=module -e "
import { closeRun } from '@probara/core';
const summary = await closeRun();
if (summary.status === 'failed') process.exitCode = 1;
"
```

On `disabled`, no run exists and no ULID is written: do not pass an empty `PROBARA_RUN_ULID` on
to the shards without knowing it (a shard with reporting on would then create a run of its own).

You can also create the run through the API (`POST /api/v1/projects/{projectId}/runs` with
`automated: true`, as `createRun` does) and share its ULID the same way. A run created in the
Probara app needs its cases picked up front.

#### `createRun(options)`

- reads the same settings as a reporter creating a run: `apiToken`, `projectId`, `baseUrl`,
  `run.name`, `run.environmentId`, `run.milestoneId`, `run.configurationUlids`, `run.tags`,
  `source`, `debug`, `clientName`, `timeoutMs`, `maxRetries`, and the seams `logger`, `env`,
  `fetch`, `sleep`, `random`, `now`;
- creates an **automated** run: the body carries `automated: true`, so the run starts without
  cases and the shards report theirs into it. It needs a Probara version that accepts automated
  runs; an older one rejects the request with 422 `validation_failed`, and `createRun` resolves
  `failed`;
- sends the run a report would create: the same default name (the CI build, such as `CI #42`,
  else `Automated run <date> <time> UTC`), the same limits on the name, tags and configuration
  ULIDs, and the same CI source (`PROBARA_BRANCH`, `PROBARA_COMMIT`, `PROBARA_BUILD_URL`, else the
  detected CI; `source: false` sends none);
- fails without a request when `run.ulid` or `PROBARA_RUN_ULID` is set: a run is already
  configured, so creating another is almost certainly a mistake;
- retries like a report, under one idempotency key;
- never rejects. It resolves a `CreateRunSummary`:

| `status`   | Meaning                                                                            |
| ---------- | ---------------------------------------------------------------------------------- |
| `created`  | The run exists. `run` is `{ ulid, displayId, state, url }`. Logged at info.        |
| `disabled` | Reporting is off or not configured. Nothing was sent.                              |
| `failed`   | A config problem (a run already set included) or the creation failed: see `error`. |

When the creation failed after the request may have reached Probara (a network error, a timeout,
a 5xx, a `201` body that could not be read, or retries that ran out on an in-flight duplicate, a
409 `conflict` with `Retry-After`), the message says so and links the project's runs:
check them before creating another run.

#### `closeRun(options)`

With `PROBARA_RUN_ULID` set, `closeRun` defaults to `false` in the reporter, so no shard closes a
run that other shards are still writing to. The final `closeRun()` call:

- reads the same settings as a reporter (`apiToken`, `projectId`, `baseUrl`, `run.ulid`, `debug`,
  `clientName`, `timeoutMs`, `maxRetries`, and the seams `logger`, `env`, `fetch`, `sleep`,
  `random`, `now`). `run.ulid` / `PROBARA_RUN_ULID` is required, and `projectId` builds the run's
  page URL;
- retries like a report, under one idempotency key;
- never rejects. It resolves a `CloseRunSummary`:

| `status`         | Meaning                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| `closed`         | The run is closed. `run` is `{ ulid, displayId, state, url }`.                        |
| `already_closed` | The run was already closed or aborted (409 `conflict`). Logged at info, not an error. |
| `disabled`       | Reporting is off or not configured. Nothing was sent.                                 |
| `failed`         | A config problem (a missing run included) or the close failed: `error` says why.      |

A 409 `conflict` with `Retry-After` is an in-flight duplicate of the same idempotency key, not a
closed run: it is retried, and `failed` once the retries run out. A `200` that answers a run still
open is `failed` too (`invalid_response`). Options that are not an object (`closeRun(null)` from
untyped JavaScript, for example) resolve `failed` as well; `createReporter(null)` returns a
reporter that is off and completes `failed`.

Whether the job fails on `failed` is your choice: the snippet above sets a non-zero exit code.

#### `listRunCaseKeys(options)`

The cases of a run, for an adapter that runs only the tests linked to them: each
`{ caseDisplayId, automationKey }` (`automationKey` is `null` for a case without one). It reads the
same settings as `closeRun` (`run.ulid` / `PROBARA_RUN_ULID` is required), then every page of
`GET /api/v1/runs/{runUlid}/case-keys`, 200 at a time, until the last; each page is retried like a
report. A cursor that does not sort after the one before (cursors are case ULIDs, in order;
`error.code` `invalid_response`), or a run of more than 1,000 pages (200,000 cases,
`MAX_RUN_CASE_KEYS_PAGES`; `error.code` `too_many_pages`), is `failed` rather than read forever. It
is the one read an app token may make. It never rejects, and logs nothing above debug, its retries
included: the caller says what a failure means.

```ts
const { status, cases, error } = await listRunCaseKeys({ run: { ulid } });
// status: 'listed' (cases holds every case), 'disabled', or 'failed' (cases is empty, error says why)
```

## Attachments

`attachments` takes Playwright's `result.attachments` as is: `{ name?, contentType?, path?, body? }`,
where `body` is a `Uint8Array` (a `Buffer`) or a string. After a report records a result, core
uploads its files in two steps: it **stages** them (multipart `file` parts), then **commits** the
staged refs to the result at positions `0..n-1`.

- **Step files**: the `attachments` of a step are uploaded after the result's own, in the order of
  the steps, and committed with the step's `stepIndex` (its position in a depth-first walk of the
  tree), so Probara shows them under that step. The files of a step core could not send (see
  [what core normalizes](#what-core-normalizes)) go to the result. The limit of 20 files counts
  them all.

- **File name**: `fileName`, else the base name of `path`, else `name`, plus an extension from
  `contentType` when `fileName` or `name` has none (`screenshot` + `image/png` is
  `screenshot.png`). One line, no path separators, at most 255 characters. `fileName` is for an
  adapter that knows a better name than the file's own, such as a content-hashed copy.
- **Temporary files**: `temporary: true` says the file at `path` is a copy the adapter removes
  after the run (the Jest reporter's copies of `probara.attach()` files). It uploads like any
  file; a [results file](#results-file) keeps a copy of its own next to it rather than pointing at
  a path that will be gone.
- **Content**: a `path` is opened with `fs.openAsBlob` when its result uploads and streamed, never
  read into memory whole. `path` wins over `body`. A missing `contentType` is sent as
  `application/octet-stream`.
- **Skipped, with a warning**: a missing, unreadable or empty file, a file over 32 MiB, an
  attachment with neither `path` nor `body`, a content type the server refuses (executables and
  scripts, such as `application/x-sh`), and every uploadable file beyond the first 20 of a result
  (one warning with the count; a skipped file does not use up one of the 20). Attachments of a
  result that was not recorded (unmatched, or its report failed) are skipped too.
- **Images**: Probara converts `image/png`, `image/jpeg` and `image/webp` attachments (by their
  `contentType`) to WebP and refuses one over 10 MiB or over 8192 px wide or tall. Core skips such
  an image with a warning naming the file and its size or dimensions, read from the file header
  (only its first 256 KiB). A full-page screenshot of a long page is the usual case. An image whose
  dimensions are not found there is sent, and the server decides. Any other type, and an image
  sent as `application/octet-stream`, is stored as a plain file up to 32 MiB.
- **Requests**: stage requests hold at most 20 files and 64 MiB, so a request stays under the
  100 MB body limit of the server's platform. A stage request carries no `Idempotency-Key` (the
  server ignores it there; a retry is safe because unreferenced staged files expire) and its body
  is rebuilt on every attempt. Each upload attempt may take `max(timeoutMs, 120000)` ms, so a large
  file on a slow link is not cut off. The commit is retried under one `Idempotency-Key`.
- **Rate limit**: every result with attachments costs at least 2 more requests (a stage and a
  commit; one more stage per extra 20 files or 64 MiB) against the organization's API rate limit
  (60 requests per minute by default). `429` answers are retried after `Retry-After`. Lower
  `attachmentConcurrency` (default 2, 1..8) to spread them, or set `uploadAttachments: false`.
- **Ordering**: reports stay strictly sequential. Uploads start once their report is recorded, and
  yield to reports: while a report is queued or in flight, no new stage or commit request starts
  (one already in flight finishes), so uploads never hold back a report under the shared rate
  limit. They resume once the reports settled. When results arrive faster than reports drain
  (for example a large JUnit import added at once), uploads wait until the last report and then
  run at `attachmentConcurrency`, retrying `429` answers.
- **Closing**: files can only be staged into an open run. When any attachment was queued, the last
  report leaves the run open, and once every upload settled core closes the run on its own
  (`POST /api/v1/runs/{runUlid}/close`), only when `closeRun` is on and every report was recorded.
  A run already closed or aborted meanwhile is fine: it is logged, and `run.state` is `closed`
  (Probara stores an aborted run as closed). Without attachments the last report closes the run, as before.
- **One bad file does not sink the others**: the server refuses a whole stage request for its
  first invalid file (422). Core then sends each file of that request on its own (with the usual
  retries), so only the refused files fail; the staged ones are still committed. Any other failure
  stops the uploads of that result, and the files staged before it are committed.
- **Failures never change `status`**: a failed stage or commit counts its files in
  `attachments.failed` and adds an entry to `attachmentErrors`. The results stay recorded.

## API

| Export                                           | What it does                                                                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createReporter(options)`                        | A reporting session: `addResult()` each test, then `complete()` (see above)                                                                                                  |
| `createRun(options)`                             | Creates one automated run (no cases) up front, a run CI shards share. Never rejects.                                                                                         |
| `closeRun(options)`                              | Closes one run, such as a run shared by CI shards. Never rejects.                                                                                                            |
| `listRunCaseKeys(options)`                       | Every case of a run: display id and automation key ([`listRunCaseKeys`](#listruncasekeysoptions)). Never rejects.                                                            |
| `resolveConfig(options, env)`                    | The configuration a reporter would use, with its problems and warnings                                                                                                       |
| `reuseRuns(options, runs)`                       | Options that report into the runs of earlier reports of a session (by project code), such as Jest's watch mode re-runs, without the warnings for shards that reuse some runs |
| `resolveBooleanSetting(...)`                     | A boolean setting of an adapter, with core's rules ([configuration](#configuration))                                                                                         |
| `resolveUrlTemplateSetting(...)`                 | An issue URL template setting of an adapter, checked ([`probara.*`](#what-a-test-says-about-itself-probara))                                                                 |
| `issueLink(id, template)`                        | The link of an issue id under a URL template                                                                                                                                 |
| `buildAutomationKey(identity, options)`          | The automation key v1 of a test                                                                                                                                              |
| `toReportEntry(input, context)`                  | One report entry from a `TestResultInput` of at most one case, inside the API limits                                                                                         |
| `applyStatusRules(status, config)`               | The status a result is sent with, and whether the filter leaves it out ([statuses](#status-mapping-and-filter))                                                              |
| `fanOutByCase(input)`                            | One `TestResultInput` per linked case ([several cases](#one-test-several-cases))                                                                                             |
| `entryTotals(entry)`                             | The result steps, case steps and case tags an entry adds to the per-report totals                                                                                            |
| `extractCaseIds`, `parseCaseIdList`, …           | Case ids in titles and lists ([case ids in titles](#case-ids-in-titles))                                                                                                     |
| `readMetadataMessages(messages)`                 | The `probara.*` metadata of one attempt, and its problems ([`probara.*`](#what-a-test-says-about-itself-probara))                                                            |
| `applyMetadataMessage(metadata, msg)`            | Merges one `probara.*` message; `false` when it is malformed                                                                                                                 |
| `createMetadataRecorder(sink, warn)`             | The checked `probara.*` helpers, handing each call to an adapter's transport as one message                                                                                  |
| `metadataResultFields(metadata, opts)`           | The parts of a `TestResultInput` the metadata decides: case links, title, suites, comment, parameters, case, links                                                           |
| `linkedCaseIds(explicit, titleIds)`              | The cases an attempt links: explicit id lists, then title ids, each once                                                                                                     |
| `caseOf(metadata, caseSteps)`                    | The case a report creates from the metadata's tags and fields and the case steps                                                                                             |
| `resolveAdapterSetup`, `createAdapterSession`, … | The setup, counts, `Sending N results` line and error log of an adapter ([bookkeeping](#the-adapters-own-bookkeeping))                                                       |
| `projectOfCase(caseDisplayId, config)`           | The project a result goes to, or `undefined` when it is dropped ([several projects](#several-projects))                                                                      |
| `readResultsFile(path)`                          | The options and results of a results file ([results file](#results-file)); `RESULTS_FILE_VERSION` is its format                                                              |
| `attachmentsFolderOf(path)`                      | The `<name>-attachments/` folder of a results file, where its in-memory bodies are                                                                                           |
| `hasFileExtension(name)`                         | Whether a file name has an extension core keeps ([attachments](#attachments))                                                                                                |
| `detectCiSource(env)`                            | The CI provider, branch, commit and build URL                                                                                                                                |
| `createClient(options)`                          | The HTTP client: `submitReport`, `createRun`, `closeRun`, `listRunCaseKeys`, and the result attachment methods                                                               |
| `createIdempotencyKey()`                         | A fresh `Idempotency-Key`. Reuse it on every attempt of one request.                                                                                                         |
| `ProbaraApiError`, `ProbaraNetworkError`         | What the client throws: an error response, or no response after the retries                                                                                                  |
| `createConsoleLogger`, `redact`                  | The default logger (`[probara] ` prefix; `stderr: true` or `stdout: true` writes every level to that stream) and the token redaction                                         |
| Types                                            | Generated from the published OpenAPI: `ReportRequest`, `StagedAttachment`, and more                                                                                          |
| Limits                                           | `MAX_RESULTS_PER_REPORT`, `MAX_ATTACHMENT_BYTES`, and the other contract limits                                                                                              |

The client methods throw; `createReporter`, `createRun`, `closeRun` and `listRunCaseKeys` never do.

A disabled `resolveConfig` result (`{ ok: false, disabled: true }`) says why in `cause` (type
`DisabledCause`): `disabled` when `enabled: false` or `PROBARA_ENABLED` turned reporting off,
`not_configured` when neither a token nor a project is set. `reason` holds the same in words.

## Failure behavior

| Situation                                            | What happens                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Network error, timeout, 408, 429, 500, 502, 503, 504 | Retried up to `maxRetries` with exponential backoff and jitter. `Retry-After` wins (capped at 120 s). |
| A `201` whose body fails to arrive                   | Retried like a network error: the same idempotency key replays the stored response                    |
| 409 with `Retry-After` (in-flight duplicate)         | Retried the same way                                                                                  |
| Any other error, or retries run out                  | That report fails. Later reports are not sent (`notSent`), and the run is left open.                  |
| Invalid `addResult` input                            | Counted in `invalid` and logged. The other results are still sent.                                    |
| Logger throws                                        | Ignored                                                                                               |

`createRun` and `closeRun` retry the same way, under one idempotency key per call. A retried run
creation whose first response got lost is replayed, not created twice. Probara does not store a
5xx answer for a replay, though: when a run creation got a 5xx, its retry runs the creation again,
so a duplicate run is possible if the first attempt had created the run before failing. That is
why a failed `createRun` that may have reached Probara says to check the project's runs.

Sending more reports after a missing one would reorder outcomes or open a second run. That is why
core stops at the first failure. Nothing throws: `complete()` always resolves, and `status` is
`partial` (some reports were recorded) or `failed` (none were).

## CI detection

| Provider        | Detected by              | Branch, commit and build URL from                                                                |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| GitHub Actions  | `GITHUB_ACTIONS=true`    | `GITHUB_HEAD_REF` / `GITHUB_REF_NAME`, `GITHUB_SHA`, the run URL                                 |
| GitLab CI       | `GITLAB_CI=true`         | `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME` / `CI_COMMIT_REF_NAME`, `CI_COMMIT_SHA`, `CI_PIPELINE_URL` |
| CircleCI        | `CIRCLECI=true`          | `CIRCLE_BRANCH`, `CIRCLE_SHA1`, `CIRCLE_BUILD_URL`                                               |
| Azure Pipelines | `TF_BUILD=true`          | the source branch, `BUILD_SOURCEVERSION`, the build results URL                                  |
| Jenkins         | `JENKINS_URL`            | `BRANCH_NAME` / `GIT_BRANCH`, `GIT_COMMIT`, `BUILD_URL`                                          |
| Bitbucket       | `BITBUCKET_BUILD_NUMBER` | `BITBUCKET_BRANCH`, `BITBUCKET_COMMIT`, the pipeline URL                                         |
| Buildkite       | `BUILDKITE=true`         | `BUILDKITE_BRANCH`, `BUILDKITE_COMMIT`, `BUILDKITE_BUILD_URL`                                    |

The first match wins. A tag build sends no branch (GitHub `GITHUB_REF_TYPE=tag`, GitLab
`CI_COMMIT_TAG` outside a merge request, Azure `refs/tags/`, Jenkins and Buildkite when the branch
is the tag). `PROBARA_BRANCH`, `PROBARA_COMMIT` and `PROBARA_BUILD_URL` override the
detected values. Invalid values are dropped, never sent. `detectCiSource(env)` exposes the same
detection.

## Security

- The token is only sent in the `Authorization` header. Every log line, error message and summary
  string is redacted against it, including server messages that echo it back.
- Config problems and warnings name the option or variable at fault. They never print its value.
- Keep `PROBARA_API_TOKEN` in your CI secret store, not in the repository. Use an app token from
  the **JUnit XML** card in **Integrations**: it can only report, it is not tied to a person, and
  you revoke it from the same card (and create a new one) when it may have leaked, or when someone
  who could read it leaves.

## License

[Apache License 2.0](./LICENSE).

<br>

<p align="center">
  <sub>Part of the <a href="https://github.com/cynch-me/probara-sdk">Probara SDK</a> · <a href="https://probara.net">probara.net</a> · <a href="https://docs.probara.net">Probara docs</a></sub>
</p>
