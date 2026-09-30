# Contributing

Thank you for helping. This repository is a pnpm workspace with four published packages:
[`@probara/core`](packages/core/README.md), the reporting library,
[`@probara/cli`](packages/cli/README.md), the `probara` command,
[`@probara/playwright-reporter`](packages/playwright-reporter/README.md), the Playwright reporter,
and [`@probara/jest-reporter`](packages/jest-reporter/README.md), the Jest reporter;
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
| `pnpm test`         | Every package's tests (the CLI's and the reporters' build what they run first) |
| `pnpm typecheck`    | TypeScript, every package                                                      |
| `pnpm lint`         | ESLint (strict, type-checked)                                                  |
| `pnpm format:check` | Prettier; `pnpm format` rewrites. Run both from the repository root.           |
| `pnpm build`        | Builds every package, after `sync-version`                                     |

To run one test file, go to its package:

```bash
cd packages/cli && pnpm exec vitest run test/import-junit.test.ts
cd packages/core && pnpm exec vitest run src/automation-key.test.ts
cd packages/playwright-reporter && pnpm exec vitest run src/translate.test.ts
cd packages/jest-reporter && pnpm exec vitest run src/translate.test.ts
```

After bumping a package's version in its `package.json`, regenerate its `src/version.ts` (its
`src/version.test.ts` fails otherwise); `pnpm build` does it too:

```bash
pnpm --filter @probara/core sync-version
pnpm --filter @probara/cli sync-version
pnpm --filter @probara/playwright-reporter sync-version
pnpm --filter @probara/jest-reporter sync-version
```

## Strict TDD

Every change of behavior starts with a failing test:

1. Write the test that shows the behavior, and run it: it must fail for the right reason.
2. Write the smallest change that makes it pass.
3. Add a second case with other inputs, so a hard-coded answer cannot pass (triangulate).
4. Refactor with the tests green.

Assert what a caller observes (exit codes, output, the requests the fake Probara receives), never
implementation details. CLI tests run the real CLI, and the reporters' end-to-end tests the real
`playwright test` and the real `jest` (29 and 30), against a fake Probara over HTTP
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

Every example in the READMEs and `docs/` of the CLI and of the reporters runs in `pnpm test`. The
helpers they share are in `packages/test-support/src/docs/`: Markdown, links and shell lines for
all three; the page markers, the job's environment, one run per project and scenario, the CI job
runner (a Buildkite pipeline runs as its upload leaves it: `$$` is `$`), the options reader and the
fetch redirect for the two reporters.

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

### The Jest reporter

`packages/jest-reporter/test/docs/` runs every example of `packages/jest-reporter/README.md` and
its `docs/` against the built reporter, in a real `jest` (Jest 30, the dev dependency), in a copy
of the docs project (`test/fixtures/docs/project/`: a `jest.config.js`, two test files and a Babel
config for tests written with `import`):

| In the docs                                                                                                              | The test                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `js`, `ts` or `json` block                                                                                             | A file of a project: the path of its first-line comment (`// tests/cart.test.js`, `// package.json`), a whole config (`module.exports =`, `export default`), a test file, or config keys wrapped into the default `jest.config.js`. The project runs, exits 0 (or `exit: <n>`) and reports. A `json` block without a path fails, like any block no row runs: a misspelled or detached marker, `jsx`, `tsx`, no language |
| `<!-- project: <id> -->` before blocks                                                                                   | Puts them in one project; a project without test files runs the docs project's tests, and a config of its own (`jest.config.mjs`, a `jest` key in `package.json`) replaces the default one                                                                                                                                                                                                                              |
| A block after `<!-- output: <project>[, scenario: <id>] -->`                                                             | Its `$ <command>` lines run in one copy of the project; the `[probara]` lines each logs (or the CLI's stdout with `stream: stdout`) equal the lines after it. `jest --watchAll` runs as a session: its first run, a re-run after a test file is saved (the scenario can ask for more, and change Probara in between), then it stops                                                                                     |
| A block after `<!-- sent: <project> -->`                                                                                 | A JSON array: each entry is a subset of the matching entry Probara receives, in order (the project runs with `--runInBand`: the order Jest runs the files in)                                                                                                                                                                                                                                                           |
| A block after `<!-- files: <project> -->`                                                                                | The files Probara receives, one `<name> <content type>` per line                                                                                                                                                                                                                                                                                                                                                        |
| A `jest` (`npx jest@30`, the `test` script of npm, pnpm or yarn) or `probara` line in a `bash`, `yaml` or `groovy` block | Runs like one CI job, `--shard` included (a watch session runs and re-runs once, and exits as its last run did), and exits 0, or the code of a trailing `# exit <n>` (`test/docs/jobs.ts`)                                                                                                                                                                                                                              |
| The tables after `<!-- options-table -->` and `<!-- runtime-options-table -->`                                           | One row per option of `ProbaraJestOptions`, read from its types, with its type; each variable sets what its option sets; every `PROBARA_*` variable the code reads has a row                                                                                                                                                                                                                                            |
| Every link                                                                                                               | Resolves, and stays inside `packages/jest-reporter/` when relative                                                                                                                                                                                                                                                                                                                                                      |

Scenarios (`test/docs/scenarios.ts`) set up the fake Probara (in every one, the organization has the
custom field `Risk area`) and the environment, such as a run with cases for `runCasesOnly`
(`run-cases`), members for `assignFailedTo` (`members`) or a watch session whose run is closed
(`watch-run-closed`). `<!-- not-run: <reason> -->` exempts a block of another tool (Qase, Test IT,
ReportPortal, Allure, TestRail and its `trcli`, jest-junit), code or command lines, and only on the
pages that compare the reporter with those tools (`docs/migrating-from-*.md`,
`docs/coming-from-*.md`). Every page with examples (`EXAMPLE_PAGES` in `examples-run.test.ts`) holds
a project and a block that checks it, and every scenario is named by a block. A command still
running 100 s after its copy of the project was made is killed, and fails with what it printed. An
output block that prints a `first seen in` warning, or one line per result, runs a project of one
test file, or `jest --runInBand`: several workers finish in any order.

## Commits and pull requests

Commits follow [Conventional Commits](https://www.conventionalcommits.org): `feat(cli): ...`,
`fix(core): ...`, `docs(cli): ...`, `test: ...`, `chore: ...`, `refactor: ...`. One commit is one
unit of work, with its tests and docs.

Before you open a pull request:

- [ ] A test failed before the change and passes after it.
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [ ] User-visible changes are in the docs and in the package's `CHANGELOG.md` under `Unreleased`
      (the CLI and the reporters; core's changes are in its README).
- [ ] No token, host name or personal path in code, fixtures, logs or docs.
- [ ] A change to an automation key is called out as breaking ([upgrading](packages/cli/docs/upgrade.md)).
- [ ] Generated API types come from `pnpm --filter @probara/core generate:api`, never edited by hand.

## Security issues

Do not open a public issue for a vulnerability: see [SECURITY.md](SECURITY.md).
