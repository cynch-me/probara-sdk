# @probara/cli

The `probara` command imports JUnit XML test results into [Probara](https://probara.net) from any
CI. It reads the reports your test framework already writes, links each test to its Probara test
case, creates the cases that are missing, uploads the files the reports reference, and closes the
run once everything is in.

It understands the JUnit dialects of these tools, and detects each one per file:

| Framework              | Writer                           | Dialect      |
| ---------------------- | -------------------------------- | ------------ |
| Jest                   | `jest-junit`                     | `jest`       |
| pytest                 | `--junitxml`                     | `pytest`     |
| Playwright             | the `junit` reporter             | `playwright` |
| Java (Maven)           | Maven Surefire                   | `surefire`   |
| Go                     | `gotestsum --junitfile`          | `gotestsum`  |
| Anything else in JUnit | any JUnit XML (`testsuite` tree) | `generic`    |

## Requirements

- Node.js 22.12 or later, on the machine that runs the import (a Python, Java or Go job needs Node
  too).
- A Probara app token, created from the **JUnit XML** card in **Integrations**
  ([get a token](docs/configuration.md#get-a-token)), and the code of the project to report into
  (such as `SHOP`). Reporting from CI needs a paid plan.

## Install

Run it without installing, or add it to a project:

```bash
npx @probara/cli --version
npm i -D @probara/cli
```

### Run it from a checkout

To try a change that is not released yet, build this repository once, then run the built bin with
Node:

```bash
git clone https://github.com/cynch-me/probara-sdk.git
cd probara-sdk
corepack enable
pnpm install
pnpm build
node packages/cli/dist/cli.js --version
```

To type `probara` like the docs do, add an alias in the checkout:
`alias probara="node $PWD/packages/cli/dist/cli.js"`. `pnpm build` builds `@probara/core` first;
the CLI finds it through the workspace link, so keep the checkout where it is.

## Quick start (60 seconds)

1. Create an app token from the **JUnit XML** card in **Integrations**
   ([get a token](docs/configuration.md#get-a-token)), and keep it in the environment. The CLI has
   no `--token` flag, so the token never shows up in a process list or a CI log:

   ```bash
   export PROBARA_API_TOKEN="probara_app_your_token"
   export PROBARA_PROJECT=SHOP
   ```

2. Check what would be sent. A dry run needs no token and sends nothing:

   ```bash
   probara import junit junit.xml --dry-run
   ```

3. Import the report:

   ```bash
   probara import junit junit.xml
   ```

The log goes to stderr and ends with a link to the run:

<!-- output: import -->

```text
$ probara import junit junit.xml
[probara] junit.xml: jest, 10 results
[probara] Results: 10 (7 passed, 2 failed, 1 skipped, 0 blocked)
[probara] Project: SHOP
[probara] Run: new run "Automated run 2026-09-29 14:05 UTC"
[probara] Base URL: https://app.probara.net
[probara] Missing cases: created
[probara] Attachments: on
[probara] Recorded 10 results (10 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

In CI, run the same command after the tests, even when they failed. Failed tests do not fail the
step: only a reporting problem does ([exit codes](docs/exit-codes.md)). Pick your CI in
[the CI guides](#documentation).

Import several files or a folder into one run, and quote globs so the shell leaves them to
`probara`:

```bash
probara import junit "reports/**/*.xml"
probara import junit target/surefire-reports
```

## Documentation

| Page                                        | What it covers                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| [Commands](docs/commands.md)                | `import junit`, `import results`, `run create`, `run close`, with their full `--help` |
| [Configuration](docs/configuration.md)      | Every option, its variable and default; precedence; self-hosted Probara               |
| [Linking tests to cases](docs/linking.md)   | Case ids in names and properties, automation keys, missing cases                      |
| [JUnit mapping and dialects](docs/junit.md) | How each framework's JUnit becomes results, and how to produce it                     |
| [Attachments](docs/attachments.md)          | Files referenced by the reports, test output, limits                                  |
| [Exit codes](docs/exit-codes.md)            | What each code means and how to fail or pass CI on purpose                            |
| [Troubleshooting](docs/troubleshooting.md)  | Problems and their solutions                                                          |
| [Debugging](docs/debugging.md)              | `--dry-run`, `--debug`, `--json`, stdout and stderr                                   |
| [Network](docs/network.md)                  | Timeouts, retries, rate limits, proxies and certificates                              |
| [Upgrading](docs/upgrade.md)                | Versioning policy and the automation key contract                                     |
| [Changelog](CHANGELOG.md)                   | What changed in each version                                                          |

CI guides: [GitHub Actions](docs/ci/github-actions.md), [GitLab CI](docs/ci/gitlab.md),
[Jenkins](docs/ci/jenkins.md), [Azure Pipelines](docs/ci/azure-pipelines.md),
[CircleCI](docs/ci/circleci.md), [Bitbucket Pipelines](docs/ci/bitbucket.md),
[Buildkite](docs/ci/buildkite.md), and [sharded runs](docs/ci/sharding.md).

## How it works

`probara` parses every file before it sends anything, so one invalid file sends nothing. Each
testcase becomes a result for `@probara/core`, which builds its automation key, keeps every field
inside the API limits, sends the results in chunks with retries, and closes the run. Library
authors can build on [`@probara/core`](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md) directly.

## License

[Apache License 2.0](./LICENSE).
