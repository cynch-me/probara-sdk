# Contributor and agent guidelines

`probara-sdk` is the open-source toolkit for reporting automated test results to
[Probara](https://probara.net). It is a pnpm workspace:

| Package                        | Location                        | Role                                                          |
| ------------------------------ | ------------------------------- | ------------------------------------------------------------- |
| `@probara/core`                | `packages/core/`                | Everything about reporting: config, keys, limits, HTTP, runs  |
| `@probara/cli`                 | `packages/cli/`                 | The `probara` command: JUnit XML import, `run create`/`close` |
| `@probara/playwright-reporter` | `packages/playwright-reporter/` | The Playwright reporter                                       |
| `@probara/test-support`        | `packages/test-support/`        | Private: the fake Probara and the docs harness helpers        |

Adapters (the CLI, the Playwright reporter) build on `@probara/core` and only translate their
source into core results. Anything two adapters would both need belongs in core. The long form of
these rules is [`CONTRIBUTING.md`](CONTRIBUTING.md); the user docs start at
[`packages/cli/README.md`](packages/cli/README.md) and
[`packages/playwright-reporter/README.md`](packages/playwright-reporter/README.md).

## Rules

- **Strict TDD.** Every behavior change starts with a failing test (`red → green → triangulate →
refactor`). Assert behavior a caller can observe, never implementation details.
- **API types are generated** from the published OpenAPI (`pnpm --filter @probara/core
generate:api`). Never hand-edit `packages/core/src/generated/`, and never depend on Probara's
  private packages.
- **Zero runtime dependencies** in `@probara/core` unless a dependency is clearly worth its weight.
- **Never break the test run.** Reporting failures are logged and returned in a summary; they
  never throw into the test framework.
- **Never log secrets.** The API token must not appear in logs, errors or summaries.
- **Docs are tested.** `packages/cli/test/docs/` runs every documented command line, help
  block, output block and XML example against the real CLI, checks the options table against
  `src/options.ts`, and resolves every link. `packages/playwright-reporter/test/docs/` runs every
  config, test file, output, sent and files block and CI command line against the real reporter
  in a real `playwright test`, and checks the options tables against the reporter's types. Change
  the docs with the behavior ([docs are tested](CONTRIBUTING.md#docs-are-tested)).
- **Fixtures are tool output.** Never hand-edit `packages/cli/test/fixtures/`; regenerate a
  dialect with `packages/cli/test/fixtures/<dialect>/generate.sh`
  ([JUnit fixtures](CONTRIBUTING.md#junit-fixtures)).
- English everywhere; Conventional Commits (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`).

## Commands

Set up, test (one file too), typecheck, lint, format, build and `sync-version`: the one list is
[`CONTRIBUTING.md` › Set up](CONTRIBUTING.md#set-up).
