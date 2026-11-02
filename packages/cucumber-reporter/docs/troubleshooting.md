# Troubleshooting

Every message the formatter writes starts with `[probara]` and goes to stderr. Read them first: they
say what was not sent, and why.

## The formatter does not load

`Failed to import formatter @probara/cucumber-reporter` means cucumber-js cannot find the package from
its own install. Install `@probara/cucumber-reporter` in the same project as `@cucumber/cucumber`, in
the same `node_modules`. The formatter needs `@cucumber/cucumber` 13.x (13.3 is tested).

## Reporting is off

`Probara reporting is off` names the cause: a missing token or project, or an option that is not
valid. Check `PROBARA_API_TOKEN` and `PROBARA_PROJECT` in the job's environment (the token is a secret,
set it in the CI settings), or `formatOptions.probara` in `cucumber.js`.

## Results do not land on the synced cases

A result creates a case when its key matches no case. Check the three parts of the key:

- The path is relative to `rootDir`, which defaults to the directory cucumber-js runs in. Run the
  formatter and `probara sync gherkin` from the same directory, or give both the same `rootDir`.
- The Feature and scenario names are the names as written, and a `Rule:` is not in the key.
- The sync ran after the last rename. Sync on the default branch before the tests.

## No output on stdout

`--format @probara/cucumber-reporter` prints nothing on stdout by design: the `[probara]` lines are on
stderr. To keep cucumber's progress output, give the formatter a path (see
[configuration](configuration.md#where-the-output-goes)).

## A scenario has no steps, or a step is missing

A scenario whose name is empty, or whose feature file has no Feature, is not sent, and the warning
names its file. A step in another language has no keyword: its action is sent without one.

## A warning says a tag is ignored

`ignored the @probara tag "@probara:shop-3"` means the tag is not a display ID such as `SHOP-12`. Use
the case's display ID, with capital letters.

## Attachments are missing

The summary counts uploads, skips and failures. A file is skipped when it is empty, too large, an image
Probara refuses, or beyond the 20 files of a result. Set `debug: true` to log each request.

## Debugging

Set `debug: true` (or `PROBARA_DEBUG=true`) to log every request, without the token. Reporting never
changes the exit code of the run: a failing run exits with its own code, and a passing run exits 0
even when Probara cannot be reached.
