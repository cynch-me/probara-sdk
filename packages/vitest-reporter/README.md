<p align="center">
  <a href="https://probara.net"><img src="https://raw.githubusercontent.com/cynch-me/probara-sdk/main/.github/assets/probara-mark.png" alt="Probara" width="120"></a>
</p>

<h1 align="center">@probara/vitest-reporter</h1>

<p align="center">Every Vitest attempt, with its steps and attachments, in Probara.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@probara/vitest-reporter"><img src="https://img.shields.io/npm/v/@probara/vitest-reporter?style=flat-square&color=5b3fd6&logo=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@probara/vitest-reporter"><img src="https://img.shields.io/npm/dm/@probara/vitest-reporter?style=flat-square&color=5b3fd6" alt="npm downloads"></a>
  <a href="https://github.com/cynch-me/probara-sdk/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/cynch-me/probara-sdk/ci.yml?branch=main&style=flat-square&label=CI&logo=githubactions&logoColor=white" alt="CI status"></a>
  <a href="https://github.com/cynch-me/probara-sdk/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-5b3fd6?style=flat-square" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.12-5b3fd6?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22.12 or later">
  <img src="https://img.shields.io/badge/vitest-3.2%20%7C%204%20%7C%205-5b3fd6?style=flat-square&logo=vitest&logoColor=white" alt="Vitest 3.2, 4 and 5">
</p>

<p align="center">
  <a href="#quick-start"><b>Quick start</b></a>
  ·
  <a href="#documentation"><b>Documentation</b></a>
  ·
  <a href="https://probara.net"><b>Probara</b></a>
  ·
  <a href="https://github.com/cynch-me/probara-sdk"><b>Probara SDK</b></a>
</p>

A [Vitest](https://vitest.dev) reporter that sends every test result of a run to
[Probara](https://probara.net): each attempt with its status, duration and errors, linked to its
Probara test case, with the steps, attachments and links your tests add. Cases that are missing get
created, and the run is closed once everything is in. Built on
[`@probara/core`](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md).

## Features

- **One result per attempt**, `retry` and `repeats` included, with Vitest's own verdict:
  `test.fails`, `skip`, `todo` (sent as skipped, with the note `Todo`), `context.skip(note)`.
- **The same keys as `probara import junit`** on Vitest's JUnit output, so switching from the JUnit
  import keeps every case and its history ([same cases as the JUnit import](#same-cases-as-the-junit-import)).
- **Linking** by a case id in a title or a `describe` (`SHOP-12 adds an item`) or `probara.id()`.
- **Test helpers** with nothing to set up, in Node (`test.concurrent` included) and in browser
  mode: `probara.step()` (nested, with expected results and data), `probara.attach()`,
  `probara.link()`, `probara.issue()`, `probara.parameters()`, and the title, suite, tags and fields
  of a new case.
- **Vitest's own files**: the attachments of `context.annotate()`, the failure screenshots of
  browser mode, and each attempt's console output with `captureOutput`
  ([attachments](docs/attachments.md), [captured output](docs/output.md)).
- **Runs** by name, with an environment, milestone, test plan, configurations and tags
  ([run options](docs/runs.md)); one run for a sharded CI job, merged from the blobs
  ([sharding](docs/ci/sharding.md)); one run per `--watch` session ([watch mode](docs/watch.md));
  only the tests of a Probara run, with `runCasesOnly` ([run selection](docs/run-selection.md)).
- **Never breaks your test run**: a reporting problem is logged, never thrown, and Vitest's exit
  code stays the tests' own. What could not be sent can be kept in a file and sent later with
  `probara import results 'probara-results*.json'`.

## Requirements

- Node.js 22.12 or later.
- Vitest 3.2 or a later 3.x, 4.x or 5.x (the peer range `^3.2.0 || ^4.0.0 || ^5.0.0`). Browser mode
  needs the browser provider of the same Vitest version ([browser mode](docs/browser-mode.md)).
- A Probara app token, created from the **Vitest** card in **Integrations**
  ([get a token](docs/configuration.md#get-a-token)), and the code of the project to report into
  (such as `SHOP`). Reporting from CI needs a paid plan.

## Install

```bash
npm install --save-dev @probara/vitest-reporter
```

## Quick start

1. In Probara, open **Workspace › Integrations**, pick the **Vitest** card and create a token
   ([get a token](docs/configuration.md#get-a-token)). Store it as a CI secret named
   `PROBARA_API_TOKEN`: the reporter reads it from the environment, never from the config.
2. In the `test` section of `vitest.config.mts`, add the reporter after `default` (the one you read
   in the terminal), with your project code (or set `PROBARA_PROJECT` instead):

   ```ts
   reporters: ['default', ['@probara/vitest-reporter', { projectId: 'SHOP' }]],
   ```

   The reporter adds its own setup file and runner to every Vitest project: there is nothing to add
   to `setupFiles` or `runner` ([configuration](docs/configuration.md)).

3. Run your tests with the token in the environment. In GitHub Actions
   ([every CI guide](#documentation)):

   ```yaml
   - name: Run Vitest tests
     run: npx vitest run
     env:
       PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
   ```

The reporter logs on stderr, in `[probara]` lines, and ends with the link to the run:

<!-- output: default -->

```
$ npx vitest run
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

Without a token, nothing is sent and the tests run as usual: with no project either, the reporter
stays quiet; with a project, it says in one line that the token is not set
([what happens with each setup](docs/configuration.md#what-happens-with-each-setup)).

A sharded CI job writes one blob per shard, with the reporter beside `blob`, and one job merges
them into one run ([sharding](docs/ci/sharding.md)):

```bash
npx vitest run --shard=1/2 --reporter=blob --reporter=@probara/vitest-reporter
npx vitest run --shard=2/2 --reporter=blob --reporter=@probara/vitest-reporter
npx vitest --merge-reports
```

## What gets reported

| Vitest                                                                               | In Probara                                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| A test, or a row of `test.each` and `test.for`                                       | A test case, matched by its automation key or linked by a case id         |
| Each attempt (`retry`) and each execution (`repeats`)                                | A result in the run, with its status, duration, start time and errors     |
| `skip`, `skipIf`, `runIf`, a test `.only` or `-t` left out, `todo`, `context.skip()` | A skipped result (`Todo`, or `Skipped: <note>`, in the notes)             |
| `probara.step()` calls                                                               | The steps of the result, nested, with their status, duration and error    |
| `probara.attach()`, `context.annotate()` files, failure screenshots, `captureOutput` | Files of the result, or of the step they were attached in                 |
| `probara.link()`, `probara.issue()`                                                  | Links of the result                                                       |
| Other `probara.*` calls, Vitest tags                                                 | The title, suite, tags, fields and steps of a new case; result parameters |
| A `beforeAll` or `afterAll` hook that throws, a test file that fails to load         | One failed result, as Vitest's JUnit output writes it                     |
| The `vitest run` command                                                             | One automated run, named after the CI build, closed at the end            |

An unhandled error (a rejection no test awaited) is no result: one warning counts them
([statuses](docs/statuses.md#errors-outside-a-test)).

A test that attaches a file sends it with its result:

<!-- project: attach -->

```ts
// tests/attach.test.ts
import { probara } from '@probara/vitest-reporter';
import { expect, it } from 'vitest';

it('attaches the receipt', async () => {
  await probara.attach({ name: 'receipt', body: 'paid 12.00', contentType: 'text/plain' });
  expect(1).toBe(1);
});
```

<!-- files: attach -->

```
receipt.txt text/plain
```

A watch session reports every re-run into one run, which stays open
([watch mode](docs/watch.md)):

<!-- output: default, scenario: watch -->

```
$ npx vitest --watch
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (open): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Watch mode: every re-run reports into R-1 of SHOP, which stays open: close it in Probara, or with probara run close --project SHOP --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
[probara] Sending 2 results of 2 tests (2 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 2 results (0 new cases, 0 unmatched) in R-1 (open): https://app.probara.net/projects/SHOP/runs/R-1
```

## Same cases as the JUnit import

The reporter gives each test the automation key `probara import junit` gives it on Vitest's own
JUnit output (`vitest run --reporter=junit`): the test file, then the `describe` blocks and the
title, each after `>` between spaces, without the case ids. For a `tests/cart.test.ts` whose
`describe('cart')` holds `it('SHOP-12 adds an item')` and `it('removes an item')`, and a
`tests/login.test.ts` whose `describe('login')` holds `it('logs in with a valid password')`, the
reporter sends:

<!-- sent: default -->

```json
[
  {
    "automationKey": "tests/cart.test.ts > cart > adds an item",
    "status": "passed",
    "caseDisplayId": "SHOP-12"
  },
  {
    "automationKey": "tests/cart.test.ts > cart > removes an item",
    "status": "passed"
  },
  {
    "automationKey": "tests/login.test.ts > login > logs in with a valid password",
    "status": "passed"
  }
]
```

Vitest's JUnit output always names the file, so the default, `keyIncludesFile: true`, gives the
keys of the import; `keyIncludesFile: false` leaves the file out, for cases whose keys were made
without it ([keys without the file](docs/linking.md#without-the-file)). A test keeps its case and
its history when you switch from the JUnit import, on Vitest 3, 4 and 5
([migrating from the JUnit import](docs/migrating-from-junit.md)); an import by CLI 0.3.0 or
earlier keyed a file that failed to load differently
([cases made by an earlier import](docs/migrating-from-junit.md#cases-made-by-an-earlier-import)).

## Documentation

| Page                                                            | What it covers                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [Configuration](docs/configuration.md)                          | Every option, its variable, type and default; precedence; getting a token                               |
| [Linking tests to cases](docs/linking.md)                       | Case ids in titles and describes, `probara.id()`, automation keys, `test.each` and `test.for`           |
| [Metadata](docs/metadata.md)                                    | Title, suite, comment, tags, fields, parameters, ignoring an attempt; the differences from the Jest API |
| [Steps](docs/steps.md)                                          | `probara.step()`: nesting, status, errors, promises, the steps of a new case                            |
| [Attachments](docs/attachments.md)                              | `probara.attach()`, files of steps, Vitest annotations, failure screenshots, limits                     |
| [Captured output](docs/output.md)                               | `captureOutput`: each attempt's console output, `silent` and `onConsoleLog`                             |
| [Links](docs/links.md)                                          | `probara.link()`, `probara.issue()` and `issueUrlTemplate`                                              |
| [Statuses](docs/statuses.md)                                    | How attempts become statuses; todo, `test.fails`, hooks, `--bail`; mapping and filter                   |
| [Retries and repeats](docs/retries.md)                          | Every attempt and every repeat is a result                                                              |
| [Run options](docs/runs.md)                                     | Name, description, environment, milestone, plan, configurations, tags, an existing run, closing         |
| [Sharding and CI](docs/ci/sharding.md)                          | One run for every shard: blob reports merged, or one run shared by the shards                           |
| [GitHub Actions](docs/ci/github-actions.md)                     | The secret, the test step, sharded jobs merged from their blobs, fork pull requests                     |
| [GitLab CI](docs/ci/gitlab.md)                                  | The variable, the test job, `parallel:` shards merged from their blobs, fork merge requests             |
| [CircleCI](docs/ci/circleci.md)                                 | A context, `parallelism` shards reporting into one run, forks                                           |
| [Azure Pipelines](docs/ci/azure-pipelines.md)                   | The secret variable, `parallel` jobs reporting into one run, forks                                      |
| [Jenkins](docs/ci/jenkins.md)                                   | `withCredentials`, parallel stages reporting into one run, fork pull requests                           |
| [Bitbucket Pipelines](docs/ci/bitbucket.md)                     | A secured variable, parallel steps reporting into one run, forks                                        |
| [Buildkite](docs/ci/buildkite.md)                               | The agents' secrets, `parallelism` jobs reporting into one run, fork pull requests                      |
| [Vitest projects and Probara projects](docs/projects.md)        | Vitest `projects`, the `project` parameter, results that go to other Probara projects                   |
| [Watch mode](docs/watch.md)                                     | One run per `--watch` session                                                                           |
| [Run selection](docs/run-selection.md)                          | `runCasesOnly`: run only the tests of a Probara run                                                     |
| [Assign failed results](docs/assign-failed.md)                  | `assignFailedTo`: who looks into failures                                                               |
| [Results file](docs/results-file.md)                            | Keep what could not be sent, send it later                                                              |
| [Browser mode](docs/browser-mode.md)                            | The providers, the helpers in a browser, `probara.attach()` and Vite's file rules                       |
| [Migrating from the JUnit import](docs/migrating-from-junit.md) | From `--reporter=junit` and `probara import junit`, keeping every case                                  |
| [Migrating from Qase](docs/migrating-from-qase.md)              | Option by option and call by call, what is different, what is not ported                                |
| [Coming from other tools](docs/coming-from-other-tools.md)      | Allure, ReportPortal and TestRail, mapped, and what is not supported                                    |
| [Troubleshooting](docs/troubleshooting.md)                      | Problems and their solutions; every line the reporter logs                                              |
| [Debugging](docs/debugging.md)                                  | `PROBARA_DEBUG`, the logs, checking what would be sent                                                  |
| [Network](docs/network.md)                                      | Requests, timeouts, retries, rate limits, proxies and certificates                                      |
| [Upgrading](docs/upgrade.md)                                    | Versioning policy, the automation key contract, Vitest versions                                         |
| [Changelog](CHANGELOG.md)                                       | What changed in each version                                                                            |

On the Probara side, the
[Vitest integration guide](https://docs.probara.net/en/guides/integrations/vitest/) covers the
card, its app tokens and what Probara shows.

## Reporting never breaks your test run

The reporter never throws into Vitest and never changes its exit code: a failed test fails the
command, a reporting problem does not. Every problem (a wrong setting, Probara unreachable, a
refused token) is logged on stderr, never with the token, and the tests keep their outcome.
`probara.*` calls never throw into a test either: a call Probara cannot use is left out with a
warning. There is no option to fail the command on a reporting error; to keep what could not be
sent, set a results file ([`resultsFile`](docs/results-file.md)).

## License

[Apache License 2.0](https://github.com/cynch-me/probara-sdk/blob/main/LICENSE).

<br>

<p align="center">
  <sub>Part of the <a href="https://github.com/cynch-me/probara-sdk">Probara SDK</a> · <a href="https://probara.net">probara.net</a> · <a href="https://docs.probara.net">Probara docs</a></sub>
</p>
