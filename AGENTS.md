# Contributor and agent guidelines

`probara-sdk` is the open-source toolkit for reporting automated test results to
[Probara](https://probara.net). It is a pnpm workspace:

| Package         | Location         | Role                                                         |
| --------------- | ---------------- | ------------------------------------------------------------ |
| `@probara/core` | `packages/core/` | Everything about reporting: config, keys, limits, HTTP, runs |

Future packages (the CLI with JUnit import, framework reporters) build on `@probara/core` and only
translate their source into core results. Anything two adapters would both need belongs in core.

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
