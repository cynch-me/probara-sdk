<p align="center">
  <a href="https://probara.net"><img src="https://raw.githubusercontent.com/cynch-me/probara-sdk/main/.github/assets/probara-mark.png" alt="Probara" width="120"></a>
</p>

<h1 align="center">@probara/jest-reporter</h1>

<p align="center">Every Jest attempt, with its steps and attachments, in Probara.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@probara/jest-reporter"><img src="https://img.shields.io/npm/v/@probara/jest-reporter?style=flat-square&color=5b3fd6&logo=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@probara/jest-reporter"><img src="https://img.shields.io/npm/dm/@probara/jest-reporter?style=flat-square&color=5b3fd6" alt="npm downloads"></a>
  <a href="https://github.com/cynch-me/probara-sdk/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/cynch-me/probara-sdk/ci.yml?branch=main&style=flat-square&label=CI&logo=githubactions&logoColor=white" alt="CI status"></a>
  <a href="https://github.com/cynch-me/probara-sdk/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-5b3fd6?style=flat-square" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.12-5b3fd6?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22.12 or later">
  <img src="https://img.shields.io/badge/jest-%3E%3D29.6-5b3fd6?style=flat-square&logo=jest&logoColor=white" alt="Jest 29.6 or later">
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

A [Jest](https://jestjs.io) reporter that sends every test result of a run to
[Probara](https://probara.net): each attempt with its status, duration and error, linked to its
Probara test case, with the steps, attachments and links your tests add. Cases that are missing get
created, and the run is closed once everything is in. Built on
[`@probara/core`](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md).

> [!NOTE]
> On npm at 0.x, where a minor version may bring breaking changes ([upgrading](docs/upgrade.md)).

## Features

- **One result per attempt**, `jest.retryTimes` retries included, with Jest's own verdict:
  `test.failing`, `test.skip`, `test.todo` (sent as skipped, with the note `Todo`).
- **The same keys as `probara import junit`** on jest-junit output, so switching from the JUnit
  import keeps every case and its history ([same cases as the JUnit import](#same-cases-as-the-junit-import)).
- **Linking** by a case id in a title or a `describe` (`SHOP-12 adds an item`) or `probara.id()`.
- **Test helpers** that work in every worker, `node` and `jsdom` alike: `probara.step()` (nested,
  with expected results and data), `probara.attach()`, `probara.link()`, `probara.issue()`,
  `probara.parameters()`, and the title, suite, tags and fields of a new case.
- **Console output** of each test attached with `captureOutput`
  ([attachments](docs/attachments.md#console-output)), and **run selection**: only the tests of a
  Probara run, with `runCasesOnly` ([run selection](docs/run-selection.md)).
- **Runs** by name, with an environment, milestone, test plan, configurations and tags
  ([run options](docs/runs.md)); one run for every shard of a sharded CI job
  ([sharding](docs/ci/sharding.md)); one run per `--watch` session ([watch mode](docs/watch.md)).
- **Never breaks your test run**: a reporting problem is logged, never thrown, and Jest's exit code
  stays the tests' own. What could not be sent can be kept in a file and sent later with
  `probara import results 'probara-results*.json'`.

## Requirements

- Node.js 22.12 or later.
- Jest 29.6 or later. The `probara.*` helpers and the setup file need jest-circus, Jest's default
  test runner (not `testRunner: 'jest-jasmine2'`).
- A Probara app token, created from the **Jest** card in **Integrations**
  ([get a token](docs/configuration.md#get-a-token)), and the code of the project to report into
  (such as `SHOP`). Reporting from CI needs a paid plan.

## Install

```bash
npm install --save-dev @probara/jest-reporter
```

## Quick start

1. In Probara, open **Workspace › Integrations**, pick the **Jest** card and create a token
   ([get a token](docs/configuration.md#get-a-token)). Store it as a CI secret named
   `PROBARA_API_TOKEN`: the reporter reads it from the environment, never from the config.
2. Add the reporter after `default` (the one you read in the terminal), with your project code (or
   set `PROBARA_PROJECT` instead):

   ```js
   // jest.config.js
   module.exports = {
     reporters: ['default', ['@probara/jest-reporter', { projectId: 'SHOP' }]],
   };
   ```

   A config that is an ES module (`jest.config.mjs`, or `jest.config.js` in a package with
   `"type": "module"`) exports the same entry:

   ```js
   // jest.config.mjs
   export default {
     reporters: ['default', ['@probara/jest-reporter', { projectId: 'SHOP' }]],
   };
   ```

3. Run your tests with the token in the environment. In GitHub Actions:

   ```yaml
   - name: Run Jest tests
     run: npx jest
     env:
       PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
   ```

Without a token and a project the reporter stays off and quiet, so local runs send nothing. In CI
it logs on stderr, in `[probara]` lines, and ends with the link to the run:

<!-- output: default -->

```text
$ npx jest
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

## What gets reported

| Jest                                                 | In Probara                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| A test                                               | A test case, matched by its automation key or linked by a case id         |
| Each attempt (`jest.retryTimes` retries too)         | A result in the run, with its status, duration, start time and error      |
| `test.skip`, `test.todo`, a skipped `describe`       | A skipped result (`Todo` in the notes of a todo)                          |
| `probara.step()` calls                               | The steps of the result, nested, with their status, duration and error    |
| `probara.attach()`, the console with `captureOutput` | Files of the result, or of the step they were attached in                 |
| `probara.link()`, `probara.issue()`                  | Links of the result                                                       |
| Other `probara.*` calls in the test                  | The title, suite, tags, fields and steps of a new case; result parameters |
| A test file whose `afterAll` hook throws             | One more failed result, as jest-junit writes it                           |
| The `jest` command                                   | One automated run, named after the CI build, closed at the end            |

A test file Jest cannot run (a syntax error, a failing import) has no tests to report: the reporter
names it in one warning ([statuses](docs/statuses.md#a-file-jest-cannot-run)).

## Same cases as the JUnit import

The reporter gives each test the automation key `probara import junit` gives it on the report of
[jest-junit](https://github.com/jest-community/jest-junit) written with
`JEST_JUNIT_ADD_FILE_ATTRIBUTE=true`: the test file, then `>` between spaces, then the describe
blocks and the title joined by spaces, without the case ids. For these two test files:

<!-- project: keys -->

```js
// tests/cart.test.js
describe('cart', () => {
  test('SHOP-12 adds an item', () => {
    expect([1, 2]).toHaveLength(2);
  });

  test('removes an item', () => {
    expect([1].filter((item) => item !== 1)).toEqual([]);
  });
});
```

<!-- project: keys -->

```js
// tests/login.test.js
describe('login', () => {
  test('logs in with a valid password', () => {
    expect('secret').toHaveLength(6);
  });
});
```

the reporter sends:

<!-- sent: keys -->

```json
[
  {
    "automationKey": "tests/cart.test.js > cart adds an item",
    "caseDisplayId": "SHOP-12",
    "status": "passed"
  },
  { "automationKey": "tests/cart.test.js > cart removes an item", "status": "passed" },
  {
    "automationKey": "tests/login.test.js > login logs in with a valid password",
    "status": "passed"
  }
]
```

If your jest-junit reports had no file attribute (its default), set `keyIncludesFile: false`: the
keys then leave the file out, like those reports ([configuration](docs/configuration.md#keyincludesfile)).
Either way, a test keeps its case and its history when you switch from the JUnit import.

## Documentation

| Page                                                            | What it covers                                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [Configuration](docs/configuration.md)                          | Every option, its variable, type and default; precedence; getting a token                       |
| [Linking tests to cases](docs/linking.md)                       | Case ids in titles and describes, `probara.id()`, automation keys, `test.each`                  |
| [Metadata](docs/metadata.md)                                    | Title, suite, comment, tags, fields, parameters, ignoring an attempt; where helpers work        |
| [Steps](docs/steps.md)                                          | `probara.step()`: nesting, status, errors, promises, the steps of a new case                    |
| [Attachments](docs/attachments.md)                              | `probara.attach()`, files of steps, console output, limits                                      |
| [Links](docs/links.md)                                          | `probara.link()`, `probara.issue()` and `issueUrlTemplate`                                      |
| [Statuses](docs/statuses.md)                                    | How attempts become statuses; todo, `test.failing`, `afterAll`; mapping and filter              |
| [Retries and flaky tests](docs/retries.md)                      | Every attempt is a result                                                                       |
| [Run options](docs/runs.md)                                     | Name, description, environment, milestone, plan, configurations, tags, an existing run, closing |
| [Sharding and CI](docs/ci/sharding.md)                          | One run for every shard                                                                         |
| [Jest and Probara projects](docs/projects.md)                   | Jest `projects`, `{displayName}`, results that go to other Probara projects                     |
| [Watch mode](docs/watch.md)                                     | One run per `--watch` session                                                                   |
| [Run selection](docs/run-selection.md)                          | `runCasesOnly`: run only the tests of a Probara run                                             |
| [Assign failed results](docs/assign-failed.md)                  | `assignFailedTo`: who looks into failures                                                       |
| [Results file](docs/results-file.md)                            | Keep what could not be sent, send it later                                                      |
| [Migrating from the JUnit import](docs/migrating-from-junit.md) | From jest-junit and `probara import junit`, keeping every case                                  |
| [Migrating from Qase](docs/migrating-from-qase.md)              | Option by option and call by call, what is different, what is not ported                        |
| [Coming from other tools](docs/coming-from-other-tools.md)      | Test IT, ReportPortal, Allure and TestRail, mapped, and what is not ported                      |
| [Troubleshooting](docs/troubleshooting.md)                      | Problems and their solutions; every line the reporter logs                                      |
| [Debugging](docs/debugging.md)                                  | `PROBARA_DEBUG`, the logs, checking what would be sent                                          |
| [Network](docs/network.md)                                      | Requests, timeouts, retries, rate limits, proxies and certificates                              |
| [Upgrading](docs/upgrade.md)                                    | Versioning policy, the automation key contract, Jest versions                                   |
| [Changelog](CHANGELOG.md)                                       | What changed in each version                                                                    |

CI guides: [GitHub Actions](docs/ci/github-actions.md), [GitLab CI](docs/ci/gitlab.md),
[CircleCI](docs/ci/circleci.md), [Azure Pipelines](docs/ci/azure-pipelines.md),
[Jenkins](docs/ci/jenkins.md), [Bitbucket Pipelines](docs/ci/bitbucket.md) and
[Buildkite](docs/ci/buildkite.md).

On the Probara side, the [Jest integration guide](https://docs.probara.net/en/guides/integrations/jest/)
covers the card, its app tokens and what Probara shows.

## Reporting never breaks your test run

The reporter never throws into Jest and never changes its exit code: a failed test fails the
command, a reporting problem does not. Every problem (a wrong setting, Probara unreachable, a
refused token) is logged on stderr, and the tests keep their outcome. `probara.*` calls never throw
into a test either: a call Probara cannot use is left out with a warning. There is no option to
fail the command on a reporting error; to keep what could not be sent, set a results file
([`resultsFile`](docs/configuration.md#results-file)).

## License

[Apache License 2.0](./LICENSE).

<br>

<p align="center">
  <sub>Part of the <a href="https://github.com/cynch-me/probara-sdk">Probara SDK</a> · <a href="https://probara.net">probara.net</a> · <a href="https://docs.probara.net">Probara docs</a></sub>
</p>
