# Results file

When a report cannot be sent (Probara unreachable, the network lost, a refused report), its results
are lost unless you keep them. Set a results file, and the reporter writes what it could not send
to it at the end of the run; `probara import results` sends it later, into the same runs.

```ts
reporter: [['@probara/playwright-reporter', { resultsFile: 'probara-results.json' }]],
```

Or `PROBARA_RESULTS_FILE=probara-results.json`, relative to the directory Playwright runs in.

## Keep what could not be sent, send it later

<!-- output: default, scenario: refused -->

```text
$ PROBARA_RESULTS_FILE=probara-results.json npx playwright test
[probara] Sending 2 results of 2 tests (2 passed, 0 failed, 0 skipped, 0 blocked)
[probara] 2 results were not sent: Probara answered 403 forbidden: <message from Probara>. No run was created or updated
[probara] Wrote the 2 results that were not sent to /work/shop/probara-results.json: send them with probara import results /work/shop/probara-results.json
```

Then, from any job that holds the token, send the file if it exists:

```bash
if [ -f probara-results.json ]; then npx @probara/cli import results probara-results.json; fi
```

- **Only when needed.** The file is written only when something was not sent: when every result
  went through, there is no file.
- **Into the same runs.** The file names the runs its results belong to: a run the failed report
  left open gets the rest of its results, and a run that was never created is created by the import
  with the same name and settings. Runs are closed like the reporter would have closed them.
- **Consumed by the import.** `probara import results` deletes the file (and its
  `probara-results-attachments/` folder) once every result was sent, and rewrites it with only what
  is still unsent otherwise. Importing it again never sends a result twice, so "import if it
  exists" is safe to run in every pipeline. `--dry-run` never touches it.
- **Never drops earlier results.** A file already at that path (another shard's, or an earlier
  run's) is never deleted by the reporter: the results of this run are added after the ones it
  holds. Give each shard its own file when shards share a disk.
- **Attachments by path.** Files are referenced where Playwright wrote them: keep the output folder
  (`test-results/`) until the file is sent. In-memory bodies are written next to the file, in
  `<name>-attachments/`.

## Reporting off: keep everything

With reporting off (`PROBARA_ENABLED=false`, or no token), the reporter writes **every** attempt to
the file, case links included. Run the tests where there is no token (a fork, a machine without
network), and import the file from a job that holds it:

<!-- output: default -->

```text
$ PROBARA_ENABLED=false PROBARA_RESULTS_FILE=probara-results.json npx playwright test
[probara] Wrote 2 results to /work/shop/probara-results.json: send them with probara import results /work/shop/probara-results.json
```

The same file shows what would be sent without sending it: see
[debugging](debugging.md#check-what-would-be-sent).

## In CI

Keep the file and the output folder as artifacts of the test job, and import them in a later job
that holds the token, only when the file exists:

```yaml
- name: Run Playwright tests
  run: npx playwright test
  env:
    PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
    PROBARA_RESULTS_FILE: probara-results.json
- name: Send what Probara did not get
  if: always()
  run: if [ -f probara-results.json ]; then npx @probara/cli import results probara-results.json; fi
  env:
    PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
```

A later step in the same job works too, as above: when Probara was only briefly away, the import
sends the rest. When it still cannot, the import exits 1 and keeps the file.

## The format

Version 1 of a JSON document: the project, the runs and the settings of the reporter (the token
never), then each result as the reporter built it, before `statusMapping` (which applies when the
file is sent). The full format is in
[core's results file](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#results-file),
and the import is described in
[`probara import results`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#probara-import-results).

## See also

- [Troubleshooting](troubleshooting.md#the-run-was-left-open).
- [Several projects](multi-project.md#failures).
