# probara-sdk

The open-source toolkit for reporting automated test results to [Probara](https://probara.net).
Test results from CI land in a Probara run, matched to test cases by an automation key. Cases that
are missing get created, and the run is closed once every result has been sent.

> **Status:** early development. All four packages are on npm at 0.x, where a minor version may
> bring breaking changes ([upgrading](packages/cli/docs/upgrade.md)).

## Packages

| Package                             | Status  | Role                                                                     |
| ----------------------------------- | ------- | ------------------------------------------------------------------------ |
| [`@probara/core`][c]                | Working | Config, automation keys, input limits, HTTP with retries, report session |
| [`@probara/cli`][l]                 | Working | The `probara` command: imports JUnit XML from any CI, shared runs        |
| [`@probara/playwright-reporter`][p] | Working | A Playwright reporter that sends every attempt of a run to Probara       |
| [`@probara/jest-reporter`][j]       | Working | A Jest reporter that sends every attempt of a run to Probara             |

Adapters (the CLI and framework reporters) only translate their source into core results.
Anything two adapters would both need belongs in `@probara/core`.

[c]: packages/core/README.md
[l]: packages/cli/README.md
[p]: packages/playwright-reporter/README.md
[j]: packages/jest-reporter/README.md

## Contributing

The requirements, the set-up steps and every command are in
[`CONTRIBUTING.md`](CONTRIBUTING.md#set-up).

Before you change code, read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md).
They cover strict TDD, the JUnit fixtures, the tested docs, generated API types, and never logging
secrets. Report vulnerabilities privately, as [`SECURITY.md`](SECURITY.md) explains.

## Links

- [`@probara/cli`: import JUnit XML into Probara](packages/cli/README.md), and
  [its docs](packages/cli/README.md#documentation)
- [`@probara/playwright-reporter`: report Playwright runs](packages/playwright-reporter/README.md),
  and [its docs](packages/playwright-reporter/README.md#documentation)
- [`@probara/jest-reporter`: report Jest runs](packages/jest-reporter/README.md), and
  [its docs](packages/jest-reporter/README.md#documentation)
- [`@probara/core` for adapter authors](packages/core/README.md)
- [Probara API reference (OpenAPI)](https://docs.probara.net/openapi/v1.json)
- [Contributing](CONTRIBUTING.md) and [contributor and agent guidelines](AGENTS.md)
- [Security policy](SECURITY.md)

## License

[Apache License 2.0](LICENSE).
