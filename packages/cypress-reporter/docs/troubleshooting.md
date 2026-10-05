# Troubleshooting

Each entry starts from what you see, then says why and what to do. The reporter logs in
`[probara]` lines on **stdout**, among Cypress's own output; `PROBARA_DEBUG=true`
([debugging](debugging.md)) adds every request. Whatever the problem, `cypress run` still ends with
the number of its own failed tests: reporting changes nothing of that. The
[last section](#every-line-the-reporter-logs) lists every line the reporter and the plugin log.

## Two processes, one run

Cypress builds the reporter in its own process from the one that loads the config, and the two meet
in a session directory. Their two sides matter when you look for a warning:

- **The plugin** (`setupNodeEvents`) logs where a `cypress run` shows its output.
- **The reporter** (the Mocha reporter Cypress creates per spec) hands every warning it raises to
  the plugin with the results of the spec it belongs to, and the plugin logs it there. That is why
  a warning about something inside a spec arrives when the **spec** ends, not at the end of the
  run. Without the plugin, the reporter logs its own lines.

Both sides resolve the same options from the same `reporterOptions`, so a problem with a setting is
the same in each process. The line you see is the plugin's: the reporter's own options are resolved
the same way, but nothing it resolves alone is written twice.

## Nothing is reported, and nothing is logged

**Why.** Without a token and a project, the reporter stays off and quiet, on purpose: local runs and
fork builds send nothing. It says so only at debug:

<!-- output: default, scenario: not-configured -->

```text
$ PROBARA_DEBUG=true npx cypress run
[probara] Probara reporting is not configured: set PROBARA_API_TOKEN and PROBARA_PROJECT to enable it
```

**Solution.** Give the step that runs `cypress run` the `PROBARA_API_TOKEN` secret, and set the
project (`projectId` in `reporterOptions`, or `PROBARA_PROJECT`). Check that the reporter is in the
`reporter` of the config Cypress used for that run
([registration](configuration.md#registration)).

## Reporting is off: a configuration problem

<!-- output: default -->

```text
$ PROBARA_RUN_ULID=R-12 npx cypress run
[probara] Probara reporting is off: PROBARA_RUN_ULID is not a ULID
```

**Why.** A setting has a wrong value, or only one of the token and the project is set. Each problem
is logged, naming the option or variable at fault (never its value), and nothing is sent. The
reporter's own settings are named the same way: `keyIncludesFile`, `captureOutput`,
`attachScreenshots`, `attachVideos`, `browserAsParameter`, `issueUrlTemplate` and `runCasesOnly`
each have a problem of their own ([configuration](configuration.md#options)).

**Solution.** Fix the setting the line names.

## Probara answers 401 or 403

<!-- output: default, scenario: unauthorized -->

```text
$ npx cypress run
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] 3 results were not sent: Probara answered 401 unauthorized: <message from Probara>. No run was created or updated
```

**Why.** `401`: the token is wrong, revoked, or from another Probara (`baseUrl`). `403`: the token
cannot report to that project, or the organization is on the free plan (reporting from CI needs a
paid plan).

**Solution.** Create a new app token from the **Cypress** card
([get a token](configuration.md#get-a-token)) and update the secret; check the project code; check
the organization's plan. To keep what was not sent, set a [results file](results-file.md).

## The reporter is registered, but nothing was sent to it

<!-- output: default -->

```text
$ npx cypress run
[probara] Sending 3 results of 3 tests (0 passed, 0 failed, 3 skipped, 0 blocked)
[probara] Recorded 3 results (0 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

**Why.** The reporter ran, the plugin ran, and every result was a skipped one — or none reached the
run at all and there is nothing else to say. Note what this is NOT: there is no line for "you
registered the plugin but no reporter". A config that registers no reporter has no plugin to warn
with, so that line could never be printed and the guard that produced it has been removed rather
than left as unreachable code. If you see nothing at all, the reporter is not registered: see
[Results are reported, but the screenshots, the video and the helpers are not](#results-are-reported-but-the-screenshots-the-video-and-the-helpers-are-not)
for the shape of a run that did report, and `PROBARA_DEBUG=true` for what core decides.

**Solution.** Check that `setupNodeEvents` returns `probaraNodeEvents(on, config)` (a function that
registers the events and returns `config`), and that the reporter is registered under the `e2e`
block Cypress ran from. Registering the plugin twice in one run leaves the second one with no
results.

## Results are reported, but the screenshots, the video and the helpers are not

<!-- output: default -->

```text
$ npx cypress run
[probara] Results are reported, but the screenshots, the videos and the probara.* helpers are not: add setupNodeEvents(on, config) { return probaraNodeEvents(on, config); } (from '@probara/cypress-reporter/setup') to the Cypress config, and require('@probara/cypress-reporter/support') in the support file
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

**Why.** The Cypress config registers the reporter but no `setupNodeEvents` of this package. Every
result is still sent, **one run per spec**, and each of those runs is closed as its spec ends, so
one run with several specs produces several runs of one or two results instead of one run with all
of them. Without the plugin there are no `before:screenshot`/`after:spec` events, so no screenshot
and no video, and no `probara` task, so no `probara.*` helper.

**Solution.** Register the plugin ([registration](configuration.md#registration)), and return its
config from `setupNodeEvents` as `probaraNodeEvents(on, config)` does. A run without the plugin
still reports everything, with one run per spec instead of one run for the whole `cypress run`: on a
sharded job every shard reports, into as many runs as it has specs.

## Another plugin stopped working, or this one did

**Why.** Cypress keeps one handler per event of `setupNodeEvents`: when two plugins register the
same event with the same `on`, the one registered last wins and the other never runs, without a
warning. With `probaraNodeEvents` registered last, the other plugin loses its handler; registered
first, this one loses its own:

| The event the plugin lost | What is missing                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `after:run`               | Everything: nothing is sent and no run is created, with no `[probara]` line at the end of the run |
| `after:spec`              | The results of every spec, and the failed result of a spec Cypress could not run                  |
| `after:screenshot`        | The screenshots of failed attempts                                                                |
| `before:spec`             | The screenshots are not matched to their spec                                                     |
| `before:run`              | The `browser` parameter of every result                                                           |

Tasks are merged, so the `probara` task is never lost this way.

**Solution.** Hand every plugin the `on` of
[cypress-on-fix](https://github.com/bahmutov/cypress-on-fix), which runs every handler of an event
in turn ([with other plugins](configuration.md#with-other-plugins)):

```js
setupNodeEvents(cypressOn, config) {
  const on = require('cypress-on-fix')(cypressOn);
  require('cypress-split')(on, config);
  probaraNodeEvents(on, config);
  return config;
}
```

## Results were not recorded (unmatched)

<!-- output: default -->

```text
$ PROBARA_CREATE_MISSING_CASES=false npx cypress run
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 1 result (0 new cases, 2 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] 2 results were not recorded (case_not_found): cypress/e2e/cart.cy.js > Cart removes an item; cypress/e2e/login.cy.js > Login logs in with a valid password
```

**Why.** A result names a case that does not exist (a typo in an id, a case of another project), or
matches no case while `createMissingCases` is off. Probara records the others and says which were
left out, with the reason.

**Solution.** Fix the id, create the case, or let the reporter create missing cases (the default).

## Every run creates new cases

**Why.** The automation keys changed: a spec, `describe` or `it` was renamed or moved, `cypress run`
was started from another directory (keys are relative to the project root), or `keyIncludesFile`
changed ([what changes a key](linking.md#automation-keys)). Coming from `probara import junit`, the
cypress-junit reports may have been written without the `file` attribute of the root suite, or with
other templates.

**Solution.** Name the cases in the titles ([linking](linking.md)), so a rename keeps them. Before a
refactor, [compare the keys](debugging.md#check-what-would-be-sent); coming from the JUnit import,
see [migrating from JUnit](migrating-from-junit.md).

## A helper said something that belongs to no test

<!-- output: default -->

```text
$ npx cypress run
[probara] Left out 1 probara.* call in cypress/e2e/helpers.cy.js: what it said belongs to no attempt that ran (probara.title() of a hook that runs no test) (first seen in cypress/e2e/helpers.cy.js; repeats are logged at debug)
[probara] Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked)
```

**Why.** A `probara.*` helper ran with no attempt of that spec running: in the `before` of a
describe, which Cypress runs before the `test` event of its first test, so no attempt has begun. The
line names every call that was dropped, and is written once per spec; what it names is never given
to another test. The opposite hook is not affected: Cypress still names the **last** test of a
describe as the running one in its `after` hook, so what a helper says there belongs to that test
([where helpers work](metadata.md#what-is-different-in-a-cypress-run)).

**Solution.** Call the helpers in the test, in a `beforeEach` or in an `afterEach`.

## A test lost its steps, files or metadata

**Why.** The reporter matches what the helpers said to an attempt by its spec, its full name (the
describe titles and the title, joined by spaces) and the moment it ran. Two tests of one spec with
the same describes and the same title share that identity, so what their helpers said cannot be
told apart and is left out rather than given to the wrong test. Cypress allows that: two `it`s with
the same title in one `describe`, or `a b` › `c` next to `a` › `b c` (the full title is what the
key is built from too, so both are one case anyway).

**Solution.** Give every test its own title. See [linking](linking.md#automation-keys) for what else
lands in one key.

## A screenshot was left out

<!-- output: default, scenario: debug -->

```text
$ PROBARA_DEBUG=true npx cypress run
[probara] Left out the screenshots of cypress/e2e/cart.cy.js that name no failed test: Checkout -- pays with voucher (failed)
```

**Why.** A debug line only. Cypress names a screenshot after the test it took it for
(`<titles joined by ' -- '> (failed)`, plus ` (attempt N)` for a retry) and the reporter attaches a
screenshot only to the result of that exact attempt. A screenshot whose name is not one of those
(`cy.screenshot('my-name')`, or a failed attempt Cypress retried with no second screenshot) belongs
to no result.

**Solution.** Take screenshots through a failure (Cypress does it on its own) and let the reporter
name them; a `cy.screenshot('name')` of your own is not attached, only logged at debug.

## Results were left out on purpose

| You see                                                                                                                | Why, and what to do                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Sending 4 results of 4 tests (3 passed, 0 failed, 1 skipped, 0 blocked); 1 left out by statusFilter`                  | The status is in `statusFilter` ([statuses](statuses.md#status-mapping-and-filter))                                          |
| `Sending 3 results of 4 tests (3 passed, 0 failed, 0 skipped, 0 blocked); 1 ignored with probara.ignore()`             | The test called `probara.ignore()` ([metadata](metadata.md))                                                                 |
| `Sending 2 results of 3 tests (2 passed, 0 failed, 0 skipped, 0 blocked); 1 linked only to cases of unlisted projects` | Every case the result links belongs to a project `projects` does not list ([projects](projects.md#several-probara-projects)) |

The `Sending` line is the summary of the whole run: it is written once, by the plugin, when the run
ends.

## The helpers did nothing

| You see                                                                                                 | Why, and what to do                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `The probara.* helpers do nothing: nothing was found at Cypress.expose('probara') when the spec ran, …` | Nothing was exposed to the browser: either the config registers no plugin, and without it there is no `probara` task to carry what a helper said ([registration](configuration.md#registration)), or `setupNodeEvents` does not return the config `probaraNodeEvents` returns, so Cypress never hands it to the browser |
| `The probara.* helpers could not send what they were told: there is no cy chain in this frame`          | A helper ran where there is no `cy` chain (a spec's top-level code, a file outside a Cypress run). Nothing is recorded                                                                                                                                                                                                  |
| `probara.* could not send what it was told: <reason>`                                                   | The `cy.task('probara', …)` of the call was refused. The test keeps running                                                                                                                                                                                                                                             |
| `probara.attach() takes { name, path } or { name, body }`                                               | A wrong argument to `probara.attach()`. The call is ignored and the test goes on ([attachments](attachments.md))                                                                                                                                                                                                        |
| `probara.attach() could not attach "<name>": its contentType is not a string`                           | A `contentType` that is not a string. The file is not attached                                                                                                                                                                                                                                                          |
| `probara.attach() could not attach "<name>": it has neither a path nor a body`                          | An attachment with neither a `path` nor a `body`                                                                                                                                                                                                                                                                        |
| `probara.attach() could not read "<path>" (<reason>): it is not attached`                               | The file of a `path` is missing or unreadable (`ENOENT`, `EISDIR`): the test goes on without it                                                                                                                                                                                                                         |
| `probara.step() takes a function as its body`                                                           | A `probara.step()` with something else than a function as its body. The body is the test's own                                                                                                                                                                                                                          |
| `probara.step() takes its options as an object ({ expected, data })`                                    | A `probara.step()` whose options are not an object                                                                                                                                                                                                                                                                      |
| `probara.<helper>() could not be recorded: <reason>`                                                    | A helper of the metadata set (`id`, `title`, `suite`, `comment`, `ignore`, `parameters`, `tags`, `fields`, `link`, `issue`) that took a value it cannot use. The test is never failed by a helper                                                                                                                       |
| `probara.<helper>() takes ...`                                                                          | One warning per wrong argument of a metadata helper, from the shared set (`probara.id() takes a case id or a list of case ids, such as PRB-12`, `probara.title() takes a string`, ...)                                                                                                                                  |
| `Ignored malformed probara metadata (type "…")`                                                         | A message from a support file of another version of the package; what it said is left out                                                                                                                                                                                                                               |

Without the plugin, every warning above is written to the **browser console** (`console.warn`) and
nowhere else. With the plugin it travels to the run's log with the rest
([two processes](#two-processes-one-run)), and the line says where it came from:
`[probara] <message> (first seen in cypress/e2e/cart.cy.js › Cart adds an item)`.

## Run selection ran every test

**Why.** With `runCasesOnly`, the plugin could not tell which tests belong to the run, so every test
ran and was reported, rather than none. One warning says why, and it is one of these four:

<!-- output: default -->

```text
$ PROBARA_RUN_CASES_ONLY=true PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 npx cypress run
[probara] Ran only the tests of run 01J9Z3K4M5N6P7Q8R9S0T1V2W3: 2 of 3 tests match its cases; 1 skipped and not reported
```

| Warning                                                                                                                                             | Why                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `runCasesOnly needs the run whose tests to run: set run.ulid or PROBARA_RUN_ULID. Every test runs and is reported`                                  | No run to take the tests from                                                                         |
| `runCasesOnly: could not read the cases of the run <ULID> (<reason>). Every test runs and is reported`                                              | The run's cases could not be read: a wrong ULID, a token of another organization, Probara unreachable |
| `runCasesOnly needs the support file: require('@probara/cypress-reporter/support') in the Cypress support file, or every test runs and is reported` | The support file is missing: without it no test can be skipped                                        |

**Solution.** Follow the warning ([when it cannot select](run-selection.md#when-it-cannot-select)).
When every test was skipped instead, no test belongs to the run:

<!-- output: default -->

```text
[probara] No test matches the cases of the run 01J9Z3K4M5N6P7Q8R9S0T1V2W3: every test was skipped, and none is reported
```

## The run stays open

Two lines mean the same thing, and neither is an error:

<!-- output: default -->

```text
[probara] The run R-1 of SHOP stays open: close it in Probara, or with probara run close --project SHOP --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
```

| Line                                                                                                            | Why, and what to do                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `The run <R> of <P> stays open: close it in Probara, or with probara run close --project <P> --run-ulid <ULID>` | The run was not created by this `cypress run` (`run.ulid`), or `closeRun` is off: close it with that command, or in Probara                                        |
| `The run <R> was left open: <url>`                                                                              | A report failed after its retries (Probara unreachable, a refused report). Keep what was not sent with a [results file](results-file.md), or close the run by hand |
| `The run <R> was already closed or aborted`                                                                     | Somebody closed it while the run was sending; nothing to do                                                                                                        |
| `Could not close the run <R>: <reason>. It was left open: <url>`                                                | The run was reported into and could not be closed: close it by hand and run the tests again                                                                        |

A run the reporter did not create (`run.ulid`, `run.ulids`) is never closed either, unless
`closeRun` says so ([run options](runs.md)).

## An attachment is missing

**Why.** The log names every file it skipped and why: over 32 MiB, an image over 10 MiB or 8192 px, a
refused content type, more than 20 files in one result, or a file `probara.attach()` could not read
when it was called ([limits](attachments.md#limits)). A file attached inside a step goes to that
step, not to the result.

**Solution.** Attach a file that exists when you call `probara.attach()`, keep files under the
limits, and attach fewer files per result.

## Probara answers 429 (too many requests)

**Why.** The organization's rate limit (60 requests per minute by default) is shared by every token
and pipeline. Attachments cost two requests per result, and a retry sends the results of the failed
attempt again ([rate limit](network.md#rate-limit)).

**Solution.** The reporter waits and retries on its own. For large suites, attach less, lower
`attachmentConcurrency`, or spread sharded pipelines in time.

## Every line the reporter logs

The lines below are the ones this package writes. The reporting library it shares with the
Playwright reporter and the CLI writes a few more (`Sending`, `Recorded`, `not recorded`, `not
sent`, `Wrote`, `Attached`, `Probara warned`, `Probara reporting is off: <problem>`); they mean the
same here as they do there.

A warning that repeats in every test is written the first time, with
`(first seen in <spec or test>; repeats are logged at debug)`, and at debug afterwards. The token
never appears in any line, even when Probara's answer echoes it.

### Nothing was reported

| Line                                                                                              | Level | Meaning and what to do                                                                                                         |
| ------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Probara reporting is not configured: set PROBARA_API_TOKEN and PROBARA_PROJECT to enable it`     | debug | [Nothing is reported](#nothing-is-reported-and-nothing-is-logged), on purpose                                                  |
| `Probara reporting is disabled by <option or variable>`                                           | debug | `enabled: false`, or `PROBARA_ENABLED`                                                                                         |
| `Probara reporting is off: <problem>`                                                             | error | A setting of the reporter or of core is wrong ([a configuration problem](#reporting-is-off-a-configuration-problem))           |
| `Probara reporting is off: the reporter could not start: <reason>`                                | error | Report it: the reporter never throws into Cypress, and says why it stopped                                                     |
| `Probara reporting is off: the reporter could not be loaded; reinstall @probara/cypress-reporter` | error | `require('@probara/cypress-reporter')` itself failed: reinstall the package (it is in the Cypress process' own `node_modules`) |
| `Ignored the unknown option "<name>" of @probara/cypress-reporter`                                | warn  | A typo in an option name. Reporting goes on without it                                                                         |
| `Results are reported, but the screenshots, the videos and the probara.* helpers are not: ...`    | warn  | [No `setupNodeEvents`](#results-are-reported-but-the-screenshots-the-video-and-the-helpers-are-not)                            |
| `Could not report a spec without setupNodeEvents: <reason>`                                       | error | A spec's results could not be sent in the run of their own (no plugin). The other specs are unaffected                         |

### Some results were left out

| Line                                                                                                               | Level | Meaning and what to do                                                                                               |
| ------------------------------------------------------------------------------------------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------- |
| `Could not report an attempt of "<test>": <reason>`                                                                | error | Report it: that one attempt is lost, and the run goes on                                                             |
| `Left out <n> probara.* call(s) in <spec>: what it said belongs to no attempt that ran (<labels>)`                 | warn  | [A helper ran with no test](#a-helper-said-something-that-belongs-to-no-test)                                        |
| `Left out the screenshots of <spec> that name no failed test: <names>`                                             | debug | [A screenshot belongs to no attempt](#a-screenshot-was-left-out)                                                     |
| `Ignored malformed probara metadata (type "…")`                                                                    | warn  | A message of a support file of another version ([helpers did nothing](#the-helpers-did-nothing))                     |
| `Dropped the issues of probara.issue(): no issueUrlTemplate turns their ids into links`                            | warn  | Set `issueUrlTemplate` ([links](links.md#probaraissue-and-issueurltemplate))                                         |
| `probara.<helper>() takes ...`, `probara.attach() could not attach "<name>": <reason>`, `probara.step() takes ...` | warn  | A wrong argument; the call is ignored and the test is never failed ([helpers did nothing](#the-helpers-did-nothing)) |
| `Could not write the results file <path>: <reason>`                                                                | error | The results file could not be written: check the path and its folder                                                 |
| `Skipped the invalid result of <what>: <reason>`                                                                   | warn  | A result core could not build; report it                                                                             |
| `Skipped an attachment: <reason>`                                                                                  | warn  | A file was left out ([an attachment is missing](#an-attachment-is-missing))                                          |

### The run stays open

| Line                                                                                                            | Level | Meaning and what to do                                                         |
| --------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------ |
| `Ran only the tests of run <ULID>: <k> of <m> tests match its cases; <s> skipped and not reported`              | info  | [Run selection](run-selection.md) worked                                       |
| `No test matches the cases of the run <ULID>: every test was skipped, and none is reported`                     | warn  | [No test belongs to the run](run-selection.md#when-it-cannot-select)           |
| `The run <R> of <P> stays open: close it in Probara, or with probara run close --project <P> --run-ulid <ULID>` | info  | A reused run, or `closeRun: false` ([the run stays open](#the-run-stays-open)) |
| `Could not create the Probara run: <reason>` / `Could not create the run: <reason>`                             | error | The run could not be created; nothing was sent                                 |
| `Could not close the run <R>: <reason>. It was left open: <url>`                                                | error | [Close it by hand](#the-run-stays-open)                                        |
| `The run <R> was already closed or aborted`                                                                     | info  | Somebody closed it meanwhile                                                   |
| `<n> results were not sent: <reasons>. <No run was created or updated \| The run <R> was left open: <url>>`     | error | Probara refused or could not be reached; set a [results file](results-file.md) |

Report a problem at [github.com/cynch-me/probara-sdk/issues](https://github.com/cynch-me/probara-sdk/issues),
with the `[probara]` lines of a run with `PROBARA_DEBUG=true`.

## See also

- [Configuration](configuration.md).
- [Debugging](debugging.md).
- [Network](network.md).
