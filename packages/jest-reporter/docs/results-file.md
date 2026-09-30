# Results file

When a report cannot be sent (Probara unreachable, the network lost, a refused report), its results
are lost unless you keep them. Set a results file, and the reporter writes what it could not send
to it at the end of the run; `probara import results` sends it later, into the same runs.

<!-- project: results-file -->

```js
reporters: ['default', ['@probara/jest-reporter', { resultsFile: 'probara-results.json' }]],
```

Or `PROBARA_RESULTS_FILE=probara-results.json`, relative to the directory `jest` runs in.

## Keep what could not be sent, send it later

<!-- output: default, scenario: refused -->

```text
$ PROBARA_RESULTS_FILE=probara-results.json npx jest
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] 3 results were not sent: Probara answered 403 forbidden: <message from Probara>. No run was created or updated
[probara] Wrote the 3 results that were not sent to /work/shop/probara-results.json: send them with probara import results /work/shop/probara-results.json
```

Then, from any job that holds the token, send whatever was left:

```bash
npx @probara/cli import results 'probara-results*.json'
```

Quote the glob: `probara` expands it, and it matches the file and the siblings described below.
When nothing matches, nothing was left unsent: the import says so and exits 0.

- **Only when needed.** The file is written only when something was not sent: when every result
  went through, there is no file.
- **Into the same runs.** The file names the runs its results belong to: a run the failed report
  left open gets the rest of its results, and a run that was never created is created by the import
  with the same name and settings. Runs are closed like the reporter would have closed them.
- **Consumed by the import.** `probara import results` sends each file on its own, then deletes it
  (and its `<name>-attachments/` folder) once every result in it was sent, or rewrites it with only
  what is still unsent. Importing again never sends a result twice, so the import is safe to run in
  every pipeline. `--dry-run` never touches the files.
- **Never touches an earlier file.** When a file is already at that path (another shard's on a
  shared disk, or an earlier run's), the reporter leaves it as it is and writes to the first free
  sibling: `probara-results-2.json`, then `-3`, and so on, each with its own attachments folder.
  The log names the file written, and the glob imports them all, oldest first.
- **Never half written.** Each file is written whole to a temporary file in the same folder first (a
  dot name the glob never matches), then appears under its name at once: an import that runs at the
  same time sees the whole file or none of it.

A second run that cannot send while the first run's file is still there:

<!-- output: default, scenario: refused -->

```text
$ PROBARA_RESULTS_FILE=probara-results.json npx jest
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] 3 results were not sent: Probara answered 403 forbidden: <message from Probara>. No run was created or updated
[probara] Wrote the 3 results that were not sent to /work/shop/probara-results.json: send them with probara import results /work/shop/probara-results.json
$ PROBARA_RESULTS_FILE=probara-results.json npx jest
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] 3 results were not sent: Probara answered 403 forbidden: <message from Probara>. No run was created or updated
[probara] Wrote the 3 results that were not sent to /work/shop/probara-results-2.json (/work/shop/probara-results.json already exists): send them with probara import results /work/shop/probara-results-2.json
```

## Attachments travel with the file

The files a result carries (what `probara.attach()` copied, the console output of
[`captureOutput`](attachments.md#console-output)) are kept next to the results file, in its
`<name>-attachments/` folder (`probara-results-attachments/`), and the file names them relative to
itself. Move or download the file and its folder together, anywhere, and import it from there: a
CI artifact another job downloads keeps its attachments.

<!-- project: kept-files -->

```js
// tests/receipt.test.js
const { probara } = require('@probara/jest-reporter');

test('prints the receipt', () => {
  probara.attach({ name: 'receipt', body: 'Total: 25.00' });
});
```

<!-- output: kept-files -->

```text
$ PROBARA_ENABLED=false PROBARA_RESULTS_FILE=probara-results.json npx jest
[probara] Wrote 1 result to /work/shop/probara-results.json: send them with probara import results /work/shop/probara-results.json
$ npx @probara/cli import results probara-results.json
[probara] probara-results.json: 1 result
[probara] Results: 1 (1 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Project: SHOP
[probara] Run: new run "Automated run 2026-09-29 14:05 UTC"
[probara] Base URL: https://app.probara.net
[probara] Missing cases: created
[probara] Attachments: on
[probara] Recorded 1 result (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Attached 1 file to results (0 skipped, 0 failed)
[probara] Deleted probara-results.json and probara-results-attachments: every result was sent
```

An upload that fails during the import is not kept for another try: its result was recorded, so it
is no longer in the file, and the folder goes with the file once every result was sent. The import
logs it and exits 1.

## Reporting off: keep everything

With reporting off (`PROBARA_ENABLED=false`, or no token), the reporter writes **every** attempt to
the file, case links included. Run the tests where there is no token (a fork, a machine without
network), and import the file from a job that holds it:

<!-- output: default -->

```text
$ PROBARA_ENABLED=false PROBARA_RESULTS_FILE=probara-results.json npx jest
[probara] Wrote 3 results to /work/shop/probara-results.json: send them with probara import results /work/shop/probara-results.json
```

The same file shows what would be sent without sending it: see
[debugging](debugging.md#check-what-would-be-sent).

## In CI

Keep the files and their `<name>-attachments/` folders as artifacts of the test job, and import them
in a later job (or step) that holds the token:

```yaml
- name: Run Jest tests
  run: npx jest
  env:
    PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
    PROBARA_RESULTS_FILE: probara-results.json
- name: Send what Probara did not get
  if: always()
  run: npx @probara/cli import results 'probara-results*.json'
  env:
    PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
```

A later step in the same job works too, as above: when Probara was only briefly away, the import
sends the rest. When it still cannot, the import exits 1 and keeps what it could not send in each
file; the files it sent are gone.

A results file is trusted input: its attachments are uploaded from the paths it names, so import
only the files your own jobs wrote. The import leaves out, with a warning, an attachment whose
relative path leads outside the folder of the file; absolute paths are kept.

## In watch mode

A watch session re-run that is refused because its run was closed is kept in the file too, naming
that run, and the log says how to send it into an open run with `--run-ulid`
([watch mode](watch.md#when-the-run-is-closed-during-the-session)).

## The format

Version 1 of a JSON document: the project, the runs and the settings of the reporter (the token
never), then each result as the reporter built it, before `statusMapping` (which applies when the
file is sent). The full format is in
[core's results file](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#results-file),
and the import (several files and globs, the JSON summary, exit codes) is described in
[`probara import results`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#probara-import-results).

## See also

- [Troubleshooting](troubleshooting.md#the-run-was-left-open).
- [Sharding](ci/sharding.md): results files of shards.
