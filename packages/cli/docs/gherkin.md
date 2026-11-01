# Gherkin

Two commands connect `.feature` files to Probara. `probara sync gherkin` sends the scenarios of the
files, so Git is the source of truth for their cases. `probara import cucumber` sends the results
of a Cucumber run, and each result lands on the scenario it ran.

Both read the same keys, so a result finds the case its scenario was synced to.

## Keys

A scenario's key is `<path> > <Feature> > <Scenario>`:

- `<path>` is the feature file relative to `--root-dir`, with `/` separators, such as
  `features/checkout/pay.feature`. Run the command from the repository root, or pass
  `--root-dir` (see [links](#links-to-the-files) for why it should be the root).
- The key is built with [key v1](linking.md), the same automation key the reporters use.
- A `Rule:` is not part of the key: a scenario under a Rule is keyed under its Feature.
- A Scenario Outline has one key, with its placeholders as written: `Pay with <method>`. Its
  Examples rows are not part of the key. Each row is a separate result, with its values as the
  result's parameters.
- Two scenarios with the same key in one file are refused: `probara sync gherkin` names both lines
  and sends nothing. Give one of them another name.

Renaming a file, its Feature or a scenario changes its key. A sync then creates a case, unless a
[move or a binding](#moves-and-bindings) finds the existing one.

## Sync scenarios: `probara sync gherkin`

### What the sync sends

The CLI parses each file with the official Gherkin parser and sends the Feature, its tags and
description, and each scenario with its steps, its Background, its Examples and its link. It never
sends step definitions or any other source code. A file that does not parse stops the command before
anything is sent, and the error names the file, line and column.

Steps keep their English keywords: `Given`, `When`, `Then`, `And`, `But` and `*`. A file written in
another language is refused, because Probara reads English keywords only.

### Scope and archiving

The arguments of the command are the scope of the sync. A synced case is archived only when its file
matches one of them and the sync does not include its scenario. Cases of files outside the scope are
not touched, so each folder can have its own job:

```bash
probara sync gherkin "features/checkout/**/*.feature"
probara sync gherkin "features/cart/**/*.feature"
```

- An archived case is kept, never deleted. A scenario that comes back restores its case.
- A glob that matches no file stops the command with exit 2. A typo must never archive a folder.
- One sync carries at most 1,000 scenarios and 20 arguments. A larger repository syncs folder by
  folder.

### Moves and bindings

Each scenario is matched in this order:

1. A `@probara:<ID>` tag binds it to the case with that display ID (`SHOP-12`), whatever its key.
   The tag is not stored as a tag of the case. An unknown ID, another project's ID, or two
   scenarios that bind one case are refused, and nothing is written.
2. Its automation key finds the case that holds it.
3. A new key moves a case that disappeared in the same sync, when the steps, Background and
   Examples of the scenario are the same as the case's. The case keeps its history under the new
   key. This needs exactly one such case; otherwise the sync creates a new case and archives the
   old one.

Changing a scenario's name, tags, description or link does not change its content, so a rename
whose steps stay the same moves the case, when that move is the only candidate.

### Links to the files

A synced case shows a link to its scenario. The CLI builds it in one of two ways:

- `--file-url`, a template with `{path}` and `{line}`, such as
  `https://git.example.com/acme/shop/blob/main/{path}#L{line}`. The path is encoded segment by
  segment.
- Without `--file-url`, the link of the CI the job runs in: GitHub Actions, GitLab CI, Bitbucket
  Pipelines and Azure Pipelines, from the commit and the repository. Other CI systems get no link.

Only `https` links are sent. Without a link, the case shows its path. The paths are relative to
`--root-dir`, so a job that runs in a subfolder of the repository needs `--root-dir` set to the
repository root for the links to open.

### Read-only synced cases

In Probara, a synced case's title, steps, precondition and file tags come from its file: change the
file, not the case. Its assignee, priority, custom fields, defects, issue links, comments, plans and
runs stay editable. Review does not apply to synced cases: the pull request is their review.

### Dry runs

`--dry-run` asks Probara for the outcome and writes nothing. Unlike `probara import junit --dry-run`,
which only parses locally, it needs the token and the project. The output says what would be
created, updated, moved, restored or archived, and `--json` prints Probara's answer.

### CI examples

GitHub Actions: sync on each push to the default branch. Pull requests from forks get no secrets,
so the sync is turned off there with `PROBARA_ENABLED`.

```yaml
name: Specs

on:
  push:
    branches: [main]

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: Sync the feature files to Probara
        run: npx @probara/cli sync gherkin "features/**/*.feature"
        env:
          PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
          PROBARA_PROJECT: SHOP
```

GitLab CI: sync on the default branch. Keep `PROBARA_API_TOKEN` in the project's CI/CD variables,
masked.

```yaml
probara-sync:
  image: node:22
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - npx @probara/cli sync gherkin "features/**/*.feature"
  variables:
    PROBARA_PROJECT: SHOP
```

## Results: `probara import cucumber`

Each scenario, and each row of a Scenario Outline, becomes one result. Each step becomes a result
step, with its keyword, its status, its duration, and its Doc String or Data Table as data. The
Background steps of a scenario sit under one `Background` step. Each result is keyed as the sync
keys its scenario. When its feature file is there, the result's suite is the one the sync gives the
scenario's case: the directories, the Feature and, under a Rule, the Rule.

```bash
npx cucumber-js --format json:results/cucumber.json
probara import cucumber results/cucumber.json
```

### Which reports it reads

The Cucumber JSON that cucumber-js writes with `--format json:<file>`, and the same layout written
by Cucumber-JVM, Reqnroll and playwright-bdd. The implementation was checked against cucumber-js 13
output; the other tools were not run here. Behave writes a different layout and is not supported.

### Why Cucumber JSON, not JUnit

A JUnit testcase has one name and one status. It has no step keywords, no Doc String or Data Table
data, no Background, and no Examples values, so the key of an outline row cannot be rebuilt from it.
Cucumber JSON gives each step's keyword, status, duration and data, and the feature file and line of
each scenario. That is what a scenario's result needs to land on its synced case.

## Cucumber results

These rules say what a result shows:

- A step passed: `passed`. A step failed, or is ambiguous: `failed`. A step that is skipped, pending
  or undefined did not run: `skipped`.
- A scenario fails when a step or a `Before` or `After` hook failed; it is skipped when a step did
  not run; otherwise it passes.
- The error of a failed step is sent with the result. An ambiguous step has no message in Cucumber's
  report, so it says that more than one step definition matches it.
- Durations come in nanoseconds in the report and are sent in milliseconds.
- Without its feature file, a scenario is keyed by the names in the report, and a note says so. An
  outline row then carries its filled-in name, such as `Pay with visa`, which matches no synced case.
  Keep the feature files in the checkout for the import.

`--fail-on-failed-tests` exits 3 when a result failed or was blocked, after the results were sent
([exit codes](exit-codes.md)).

## See also

- [Commands](commands.md#probara-sync-gherkin): the full options of both commands.
- [Linking tests to cases](linking.md): automation keys and case ids.
- [Exit codes](exit-codes.md).
