# Contributing

Thank you for helping. This repository is a pnpm workspace with three published packages:
[`@probara/core`](packages/core/README.md), the reporting library,
[`@probara/cli`](packages/cli/README.md), the `probara` command, and
[`@probara/playwright-reporter`](packages/playwright-reporter/README.md), the Playwright reporter;
`@probara/test-support` is private (the fake Probara and the docs harness helpers).
[`AGENTS.md`](AGENTS.md) holds the rules in short; this page is the long form, and holds the one
list of the commands ([set up](#set-up)).

## Set up

Requirements: Node.js 22.12 or later (`.nvmrc`), and pnpm through Corepack.

```bash
corepack enable
pnpm install
pnpm test
```

| Command             | What it does                                                                   |
| ------------------- | ------------------------------------------------------------------------------ |
| `pnpm test`         | Every package's tests (the CLI's and the reporter's build what they run first) |
| `pnpm typecheck`    | TypeScript, every package                                                      |
| `pnpm lint`         | ESLint (strict, type-checked)                                                  |
| `pnpm format:check` | Prettier; `pnpm format` rewrites. Run both from the repository root.           |
| `pnpm build`        | Builds every package, after `sync-version`                                     |

To run one test file, go to its package:

```bash
cd packages/cli && pnpm exec vitest run test/import-junit.test.ts
cd packages/core && pnpm exec vitest run src/automation-key.test.ts
cd packages/playwright-reporter && pnpm exec vitest run src/translate.test.ts
```

After bumping a package's version in its `package.json`, regenerate its `src/version.ts` (its
`src/version.test.ts` fails otherwise); `pnpm build` does it too:

```bash
pnpm --filter @probara/core sync-version
pnpm --filter @probara/cli sync-version
pnpm --filter @probara/playwright-reporter sync-version
```

## Strict TDD

Every change of behavior starts with a failing test:

1. Write the test that shows the behavior, and run it: it must fail for the right reason.
2. Write the smallest change that makes it pass.
3. Add a second case with other inputs, so a hard-coded answer cannot pass (triangulate).
4. Refactor with the tests green.

Assert what a caller observes (exit codes, output, the requests the fake Probara receives), never
implementation details. CLI tests run the real CLI, and the reporter's end-to-end tests the real
`playwright test`, against a fake Probara over HTTP
(`packages/test-support/src/fake-probara.ts`, in a private workspace package the tests of every
adapter share); nothing mocks `fetch` inside core.

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

Every example in the READMEs and `docs/` of the CLI and of the Playwright reporter runs in
`pnpm test`. The Markdown, link and shell helpers they share are in
`packages/test-support/src/docs/`.

### The CLI

`packages/cli/test/docs/` runs every example of `packages/cli/README.md` and `packages/cli/docs/`
against the real CLI:

| In the docs                                                                                                                                             | The test                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The table after `<!-- options-table -->`                                                                                                                | Equals the options registry (`src/options.ts`), row for row                                                                                             |
| A block after `<!-- help: <command> -->`                                                                                                                | Equals `probara <command> --help`, byte for byte                                                                                                        |
| A `probara` or `npx @probara/cli` line in a `bash`, `yaml` or `groovy` block                                                                            | Runs against a fake Probara and exits 0, or the code of a trailing `# exit <n>`                                                                         |
| A block after `<!-- output: <scenario> -->`                                                                                                             | Starts with `$ <command>`, and the rest equals its output in that scenario (`test/docs/scenarios.ts`)                                                   |
| A block after `<!-- dry-run -->`                                                                                                                        | Equals the dry run of the `xml` block right before it                                                                                                   |
| Every relative link and `#anchor`, and every `https://github.com/cynch-me/probara-sdk/blob/main/` link, here and in every `*.md` at the repository root | Resolves. The package docs ship in the npm tarball: their relative links stay inside `packages/cli/`, and a file outside it is linked by its GitHub URL |

The root `*.md` files are the ones git tracks, so local notes stay out; without git (a copy
without `.git`), every one on disk. In CI (`CI` set), a git that cannot list them fails the test.

Command lines run in a temporary workspace laid out by `WORKSPACE_FILES` in
`test/docs/harness.ts`: an example that reads a new path needs an entry there. ULIDs, dates, UUIDs
and delays are normalized before comparing. After you change a help text or an option, run the CLI
tests and paste the new output where they point.

### The Playwright reporter

`packages/playwright-reporter/test/docs/` runs every example of `packages/playwright-reporter/README.md`
and its `docs/` against the built reporter, in a real `playwright test`, in a copy of the docs
project (`test/fixtures/docs/project/`):

| In the docs                                                                    | The test                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `ts` or `js` block                                                           | A file of a project: the path of its first-line comment (`// tests/cart.spec.ts`), a whole config, a test file, or config keys wrapped into the default config. The project runs, exits 0 (or `exit: <n>`) and reports |
| `<!-- project: <id> -->` before blocks                                         | Puts them in one project; a project without test files runs the docs project's tests                                                                                                                                   |
| A block after `<!-- output: <project>[, scenario: <id>] -->`                   | Its `$ <command>` lines run in one copy of the project; the `[probara]` lines each logs (or the CLI's stdout with `stream: stdout`) equal the lines after it                                                           |
| A block after `<!-- sent: <project> -->`                                       | A JSON array: each entry is a subset of the matching entry Probara receives, in order                                                                                                                                  |
| A block after `<!-- files: <project> -->`                                      | The files Probara receives, one `<name> <content type>` per line                                                                                                                                                       |
| A `playwright` or `probara` line in a `bash`, `yaml` or `groovy` block         | Runs like one CI job and exits 0, or the code of a trailing `# exit <n>` (`test/docs/jobs.ts`)                                                                                                                         |
| The tables after `<!-- options-table -->` and `<!-- runtime-options-table -->` | One row per option of `ProbaraPlaywrightOptions`, read from its types, with its type; each variable sets what its option sets; every `PROBARA_*` variable the code reads has a row                                     |
| Every link                                                                     | Resolves, and stays inside `packages/playwright-reporter/` when relative                                                                                                                                               |

CI has no browser: examples get a stand-in `page` whose methods resolve, and every request goes to
the fake Probara, whatever base URL an example names. `<!-- not-run: <reason> -->` exempts a block
of another tool, and only on the Qase migration page.

## Commits and pull requests

Commits follow [Conventional Commits](https://www.conventionalcommits.org): `feat(cli): ...`,
`fix(core): ...`, `docs(cli): ...`, `test: ...`, `chore: ...`, `refactor: ...`. One commit is one
unit of work, with its tests and docs.

Before you open a pull request:

- [ ] A test failed before the change and passes after it.
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [ ] User-visible changes are in the docs and in the package's `CHANGELOG.md` under `Unreleased`
      (the CLI and the reporter; core's changes are in its README).
- [ ] No token, host name or personal path in code, fixtures, logs or docs.
- [ ] A change to an automation key is called out as breaking ([upgrading](packages/cli/docs/upgrade.md)).
- [ ] Generated API types come from `pnpm --filter @probara/core generate:api`, never edited by hand.

## Security issues

Do not open a public issue for a vulnerability: see [SECURITY.md](SECURITY.md).
