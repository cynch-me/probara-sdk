# probara-sdk

The open-source toolkit for reporting automated test results to [Probara](https://probara.net).
Test results from CI land in a Probara run, matched to test cases by an automation key. Cases that
are missing get created, and the run is closed once every result has been sent.

> **Status:** early development. Nothing is published to npm yet.

## Packages

| Package              | Status  | Role                                                                     |
| -------------------- | ------- | ------------------------------------------------------------------------ |
| [`@probara/core`][c] | Working | Config, automation keys, input limits, HTTP with retries, report session |
| [`@probara/cli`][l]  | Working | The `probara` command: imports JUnit XML from any CI, shared runs        |
| Playwright reporter  | Planned | A Playwright `reporter` that sends each run to Probara                   |

Adapters (the CLI and framework reporters) only translate their source into core results.
Anything two adapters would both need belongs in `@probara/core`.

[c]: packages/core/README.md
[l]: packages/cli/README.md

## Quick start for contributors

Requirements: Node.js 22.12 or later, and pnpm through Corepack.

```bash
corepack enable
pnpm install
pnpm test        # every package
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

To run one test file, go to the package directory:

```bash
cd packages/core && pnpm exec vitest run src/reporter.test.ts
```

Before you change code, read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md).
They cover strict TDD, the JUnit fixtures, the tested docs, generated API types, and never logging
secrets. Report vulnerabilities privately, as [`SECURITY.md`](SECURITY.md) explains.

## Links

- [`@probara/cli`: import JUnit XML into Probara](packages/cli/README.md), and
  [its docs](packages/cli/README.md#documentation)
- [`@probara/core` for adapter authors](packages/core/README.md)
- [Probara API reference (OpenAPI)](https://docs.probara.net/openapi/v1.json)
- [Contributing](CONTRIBUTING.md) and [contributor and agent guidelines](AGENTS.md)
- [Security policy](SECURITY.md)

## License

[Apache License 2.0](LICENSE).
