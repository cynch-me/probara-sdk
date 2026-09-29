# probara-sdk

The open-source toolkit for reporting automated test results to [Probara](https://probara.net).
Test results from CI land in a Probara run, matched to test cases by an automation key. Cases that
are missing get created, and the run is closed once every result has been sent.

> **Status:** early development. Nothing is published to npm yet.

## Packages

| Package              | Status  | Role                                                                     |
| -------------------- | ------- | ------------------------------------------------------------------------ |
| [`@probara/core`][c] | Working | Config, automation keys, input limits, HTTP with retries, report session |
| CLI                  | Planned | `probara` command, starting with JUnit XML import                        |
| Playwright reporter  | Planned | A Playwright `reporter` that sends each run to Probara                   |

Adapters (the CLI and framework reporters) only translate their source into core results.
Anything two adapters would both need belongs in `@probara/core`.

[c]: packages/core/README.md

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

Before you change code, read [`AGENTS.md`](AGENTS.md). It covers strict TDD, generated API
types, zero runtime dependencies, and never logging secrets.

## Links

- [`@probara/core` for adapter authors](packages/core/README.md)
- [Probara API reference (OpenAPI)](https://docs.probara.net/openapi/v1.json)
- [Contributor and agent guidelines](AGENTS.md)

## License

To be decided.
