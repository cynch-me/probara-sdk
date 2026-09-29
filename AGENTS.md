# Contributor and agent guidelines

`probara-sdk` is the open-source toolkit for reporting automated test results to
[Probara](https://probara.net). It is a pnpm workspace:

| Package         | Location         | Role                                                          |
| --------------- | ---------------- | ------------------------------------------------------------- |
| `@probara/core` | `packages/core/` | Everything about reporting: config, keys, limits, HTTP, runs  |
| `@probara/cli`  | `packages/cli/`  | The `probara` command: JUnit XML import, `run create`/`close` |

Adapters (the CLI, future framework reporters) build on `@probara/core` and only translate their
source into core results. Anything two adapters would both need belongs in core. The long form of
these rules is [`CONTRIBUTING.md`](CONTRIBUTING.md); the CLI's user docs start at
[`packages/cli/README.md`](packages/cli/README.md).

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
- **CLI docs are tested.** `packages/cli/test/docs/` runs every documented command line, help
  block, output block and XML example against the real CLI, checks the options table against
  `src/options.ts`, and resolves every link. Change the docs with the behavior.
- **Fixtures are tool output.** Never hand-edit `packages/cli/test/fixtures/`; regenerate with its
  `generate.sh` scripts.
- English everywhere; Conventional Commits (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`).

## Commands

```bash
corepack enable
pnpm install
pnpm test          # all packages
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build         # runs sync-version first

# After bumping packages/core/package.json: regenerate src/version.ts (src/version.test.ts fails otherwise)
pnpm --filter @probara/core sync-version

# One test file, from the package directory
cd packages/core && pnpm exec vitest run src/automation-key.test.ts
```
