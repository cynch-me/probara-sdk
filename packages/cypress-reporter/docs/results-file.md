# Results file

A Cypress run that cannot reach Probara — a refused token, an unreachable API, reporting turned off
on purpose — can keep everything it would have sent in a file, and send it later with the CLI. Set
`resultsFile` (`PROBARA_RESULTS_FILE`, relative to the directory `cypress run` was started in):

```js
// cypress.config.js
module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: { projectId: 'SHOP', resultsFile: 'results/probara-results.json' },
    setupNodeEvents(on, config) {
      return probaraNodeEvents(on, config);
    },
  },
});
```

## When the file is written

| What happened                                                                                               | What is written                                                                                                      |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Something could not be sent (Probara refused the token, was unreachable, a report failed after its retries) | Exactly the results that were not sent, with a line that names them and the file                                     |
| Reporting is off (`enabled: false`, `PROBARA_ENABLED=false`, or no token and no project)                    | Every result of the run, so a job without secrets can run the tests and another job, which has the token, sends them |

Nothing else: a run that sent everything writes no file at all, and the line below says which of
the two happened:

```text
$ npx cypress run
[probara] Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked)
[probara] 1 result was not sent: Probara answered 403 forbidden: <message from Probara>. No run was created or updated
[probara] Wrote the 1 result that was not sent to /work/shop/results/probara-results.json: send them with probara import results /work/shop/results/probara-results.json
```

**The file is never overwritten.** A writer never touches a file already there (another shard's, an
earlier run's) and writes to the first free sibling instead: `probara-results-2.json`,
`probara-results-3.json`, and so on. Two shards that fail the same way therefore keep both sets.

## What is in it, and what is not

```json
{
  "version": 1,
  "project": "SHOP",
  "run": { "name": "Cypress run", "close": true },
  "rootDir": "/work/shop",
  "createMissingCases": true,
  "results": [
    {
      "identity": { "file": "cypress/e2e/cart.cy.js", "titlePath": ["Cart adds an item"] },
      "status": "passed"
    }
  ]
}
```

- **The results, as the reporter built them**: the identity, the status, the duration, the start
  time, the error in the notes, the steps, the links and the parameters of each one.
- **The settings that sent them**: the project, the run (its name, its tags, the run it reported
  into), the `rootDir` the keys are relative to and `createMissingCases`, so the file can be sent
  from another machine and still land in the same case.
- **The files the browser attached, copied next to it** in `probara-results-attachments/` and
  referenced relative to the folder of the file itself: a `probara.attach()` body or file, the
  captured console output. That folder moves with the file, so a CI artifact imported in another job
  sends them.
- **The files Cypress wrote, by absolute path**: a screenshot and a video are files of the
  workspace, not copies, so a machine that never had them cannot send that one file of that one
  result.
- **Never the token.** Not in the file, not in the copies of the attachments, and not in any log
  line, even when Probara's own answer echoes it.

Statuses are written **before** `statusMapping`, and the mapping applies again when the file is
sent: a file sent into a project configured with the same mapping records what the run would have
recorded.

## Sending it later

```bash
npx @probara/cli import results results/probara-results.json
```

The file goes into the same run it belongs to (the one its `run` names, or the ones the reporter
reported into), with the same keys and the same case links, and the run the import created is closed
at the end. To see what it would send first, with no token and nothing sent:

```bash
npx @probara/cli import results results/probara-results.json --dry-run
```

```text
$ npx @probara/cli import results results/probara-results.json --dry-run
passed	SHOP-12	cypress/e2e/cart.cy.js > Cart adds an item
passed	-	cypress/e2e/cart.cy.js > Cart removes an item
```

## Sending it from another machine

Keep the file **and** its `probara-results-attachments/` folder together, and quote the glob so the
shell does not expand it (the glob matches the file and its siblings):

```bash
npx @probara/cli import results 'results/probara-results*.json'
```

That is the whole pattern for a pipeline with the tests and the token in different jobs: the job that
runs Cypress has no token, so nothing is sent there and everything is written to the file; the job
that holds the token uploads it as an artifact together with its attachments folder and sends it
with the CLI.

```bash
# The job that runs the tests
PROBARA_ENABLED=false PROBARA_PROJECT=SHOP PROBARA_RESULTS_FILE=results/probara-results.json npx cypress run
```

## What a refused run loses

Nothing, with a results file set: every result that could not be sent is on disk with its files,
and the line above names the file. Without one, the results of a refused run are lost — they are
logged as not sent, and nothing else holds them. Set it in CI, where a refusal is likeliest.

## See also

- [Configuration](configuration.md#results-file): the option and its variable.
- [Troubleshooting](troubleshooting.md): what a refusal looks like, and every line the reporter logs.
- [Network](network.md): when Probara is unreachable, and how the reporter retries.
