# Contributing

Thank you for helping. This repository is a pnpm workspace with two packages:
[`@probara/core`](packages/core/README.md), the reporting library, and
[`@probara/cli`](packages/cli/README.md), the `probara` command. [`AGENTS.md`](AGENTS.md) holds the
rules in short; this page is the long form.

## Set up

Requirements: Node.js 22.12 or later (`.nvmrc`), and pnpm through Corepack.

```bash
corepack enable
pnpm install
pnpm test
```

| Command             | What it does                                                         |
| ------------------- | -------------------------------------------------------------------- |
| `pnpm test`         | Every package's tests (the CLI's tests build core and the CLI first) |
| `pnpm typecheck`    | TypeScript, every package                                            |
| `pnpm lint`         | ESLint (strict, type-checked)                                        |
| `pnpm format:check` | Prettier; `pnpm format` rewrites. Run both from the repository root. |
| `pnpm build`        | Builds every package                                                 |

To run one test file, go to its package:

```bash
cd packages/cli && pnpm exec vitest run test/import-junit.test.ts
```

## Strict TDD

Every change of behavior starts with a failing test:

1. Write the test that shows the behavior, and run it: it must fail for the right reason.
2. Write the smallest change that makes it pass.
3. Add a second case with other inputs, so a hard-coded answer cannot pass (triangulate).
4. Refactor with the tests green.

Assert what a caller observes (exit codes, output, the requests the fake Probara receives), never
implementation details. CLI tests run the real CLI against a fake Probara over HTTP
(`packages/cli/test/support/fake-probara.ts`); nothing mocks `fetch` inside core.

## JUnit fixtures

`packages/cli/test/fixtures/` holds real output of Jest, pytest, Playwright, Maven Surefire and
gotestsum, produced by small projects in each `<dialect>/source/`. Nobody edits the XML by hand:

1. Install the tool versions listed at the top of `<dialect>/generate.sh`.
2. Run `packages/cli/test/fixtures/<dialect>/generate.sh`. It runs the tool, then `sanitize.mjs`,
   which replaces machine-specific strings (home, host, user, temp paths).
3. Review the diff: only times and timestamps should change. Commit the fixture with the test that
   needs it.

The [fixtures README](packages/cli/test/fixtures/README.md) describes what each tool writes.
Prettier and ESLint skip the folder: keep it byte-exact.

## Docs are tested

Every example in `packages/cli/README.md` and `packages/cli/docs/` runs against the real CLI in
`pnpm test` (`packages/cli/test/docs/`):

| In the docs                                                                  | The test                                                                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| The table after `<!-- options-table -->`                                     | Equals the options registry (`src/options.ts`), row for row                                           |
| A block after `<!-- help: <command> -->`                                     | Equals `probara <command> --help`, byte for byte                                                      |
| A `probara` or `npx @probara/cli` line in a `bash`, `yaml` or `groovy` block | Runs against a fake Probara and exits 0, or the code of a trailing `# exit <n>`                       |
| A block after `<!-- output: <scenario> -->`                                  | Starts with `$ <command>`, and the rest equals its output in that scenario (`test/docs/scenarios.ts`) |
| A block after `<!-- dry-run -->`                                             | Equals the dry run of the `xml` block right before it                                                 |
| Every relative link and `#anchor`                                            | Resolves                                                                                              |

Command lines run in a temporary workspace laid out by `WORKSPACE_FILES` in
`test/docs/harness.ts`: an example that reads a new path needs an entry there. ULIDs, dates, UUIDs
and delays are normalized before comparing. After you change a help text or an option, run the CLI
tests and paste the new output where they point.

## Commits and pull requests

Commits follow [Conventional Commits](https://www.conventionalcommits.org): `feat(cli): ...`,
`fix(core): ...`, `docs(cli): ...`, `test: ...`, `chore: ...`, `refactor: ...`. One commit is one
unit of work, with its tests and docs.

Before you open a pull request:

- [ ] A test failed before the change and passes after it.
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [ ] User-visible changes are in the docs and in the package's `CHANGELOG.md` under `Unreleased`.
- [ ] No token, host name or personal path in code, fixtures, logs or docs.
- [ ] A change to an automation key is called out as breaking ([upgrading](packages/cli/docs/upgrade.md)).
- [ ] Generated API types come from `pnpm --filter @probara/core generate:api`, never edited by hand.

## Security issues

Do not open a public issue for a vulnerability: see [SECURITY.md](SECURITY.md).
