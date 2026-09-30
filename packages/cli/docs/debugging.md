# Debugging

Four tools, from the cheapest to the most detailed: the pre-flight log every import prints,
`--dry-run`, `--json`, and `--debug`.

## stdout and stderr

| Stream | Holds                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------- |
| stderr | Every log line, prefixed with `[probara] `: the pre-flight block, warnings, errors, the outcome |
| stdout | Machine output only: `--json` documents, dry-run lines, the ULID of `run create`, help, version |

So a script can read stdout while the log stays in the CI output, or goes to a file:

```bash
probara import junit junit.xml --json > probara-summary.json
probara import junit junit.xml 2> probara.log
```

Without `--json`, `import junit` and `run close` print nothing on stdout.

## Dry run

`--dry-run` parses every file, resolves the configuration and prints what would be sent: one line
per result with its status, its linked case (`-` for none) and its automation key, separated by
tabs, then a total. It sends nothing and needs no token. With a project (`PROBARA_PROJECT` or
`--project`) it links ids like a real import; without one it says so:

<!-- output: dry-run -->

```text
$ probara import junit junit.xml --dry-run
[probara] junit.xml: jest, 10 results
[probara] Results: 10 (7 passed, 2 failed, 1 skipped, 0 blocked)
[probara] Project: (none: ids in test names are not linked)
[probara] Run: new run "Automated run 2026-09-29 14:05 UTC"
[probara] Base URL: https://app.probara.net
[probara] Missing cases: created
[probara] Attachments: on
passed	-	login PRB-12 logs in with a valid password
failed	-	login rejects a wrong password
failed	-	login crashes on an unexpected exception
skipped	-	login supports SSO (skipped: SSO provider not configured)
passed	-	login session refresh renews the token before expiry
passed	-	login username alice has length 5
passed	-	login username bob has length 3
passed	-	login prints to stdout and stderr
passed	-	login accepts café and ñandú
passed	-	[PRB-13] top-level test outside any describe
Total: 10 results from 1 file (7 passed, 2 failed, 1 skipped, 0 blocked)
[probara] Dry run: nothing was sent
```

- A dry run ignores `PROBARA_ENABLED`, and exits 0 unless a file or an option is wrong (exit 2)
  or a result is one core could not send (exit 1, like a real import; `invalid` in `--json`; a
  bug in the CLI).
- It warns about attachments it cannot find, but uploads nothing.
- `--dry-run --json` prints the entries exactly as they would be sent (key, title, suite path,
  duration, notes, execution time):

<!-- output: dry-run-stdout -->

```text
$ probara import junit attachments/cart.xml --dry-run --json
{
  "dryRun": true,
  "exitCode": 0,
  "files": [
    {
      "path": "attachments/cart.xml",
      "dialect": "generic",
      "results": 1
    }
  ],
  "tests": {
    "passed": 1,
    "failed": 0,
    "skipped": 0,
    "blocked": 0
  },
  "invalid": 0,
  "entries": [
    {
      "status": "passed",
      "automationKey": "checkout.CartTest > shows the cart",
      "title": "shows the cart",
      "suitePath": [
        "checkout.CartTest"
      ],
      "durationMs": 1200
    }
  ]
}
```

## JSON output

`--json` prints one document on stdout when the command ran (not on exit 2):

| Command                  | Document                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `import junit`           | `{ status, exitCode, files, tests, summary }`; `summary` is core's report summary       |
| `import junit --dry-run` | `{ dryRun: true, exitCode, files, tests, invalid, entries }`                            |
| `run create`             | `{ status: "created", run }`, `{ status: "disabled" }` or `{ status: "failed", error }` |
| `run close`              | `{ status: "closed" \| "already_closed", run }`, `disabled` or `failed`                 |

Each `files[]` entry has the `path` relative to the current directory when the file is inside it
(`..reports/junit.xml` included), and absolute otherwise.

`summary` holds `status` (`completed`, `partial`, `failed`, `empty` or `disabled`), `run` (ULID,
display id, state, URL), `recorded`, `created`, `unmatched`, `invalid`, `filtered`, `notSent`, `errors`,
`attachments` and `attachmentErrors`
([core's summary](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#the-summary)).

```bash
probara import junit junit.xml --json | jq -r .summary.run.url
```

<!-- output: stdout -->

```text
$ probara import junit junit.xml --json
{
  "status": "completed",
  "exitCode": 0,
  "files": [
    {
      "path": "junit.xml",
      "dialect": "jest",
      "results": 10
    }
  ],
  "tests": {
    "passed": 7,
    "failed": 2,
    "skipped": 1,
    "blocked": 0
  },
  "summary": {
    "status": "completed",
    "recorded": 10,
    "created": 10,
    "unmatched": [],
    "invalid": 0,
    "filtered": 0,
    "notSent": 0,
    "errors": [],
    "attachments": {
      "uploaded": 0,
      "skipped": 0,
      "failed": 0
    },
    "attachmentErrors": [],
    "run": {
      "ulid": "01J9Z3K4M5N6P7Q8R9S0T1V2W3",
      "displayId": "R-1",
      "state": "closed",
      "url": "https://app.probara.net/projects/SHOP/runs/R-1"
    }
  }
}
```

## Debug log

`--debug` (or `PROBARA_DEBUG=true`) adds a line for every HTTP attempt, with its idempotency key,
the pre-flight lines of every file past the tenth, and repeated warnings that are otherwise logged
once:

<!-- output: import -->

```text
$ probara import junit junit.xml --debug
[probara] junit.xml: jest, 10 results
[probara] Results: 10 (7 passed, 2 failed, 1 skipped, 0 blocked)
[probara] Project: SHOP
[probara] Run: new run "Automated run 2026-09-29 14:05 UTC"
[probara] Base URL: https://app.probara.net
[probara] Missing cases: created
[probara] Attachments: on
[probara] Sending report 4e4f1052-acfb-41a7-815f-6f246f074aad (attempt 1 of 5)
[probara] Recorded 10 results (10 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

Request bodies and headers are never logged.

## The token is redacted

- The token is only read from `PROBARA_API_TOKEN` and only sent in the `Authorization` header.
- Every log line, error, `--json` document and dry-run line is redacted: the token is replaced by
  `[redacted]` wherever it appears, including server messages that echo it back.
- Configuration errors name the option or variable at fault, never its value. A `--token` flag is
  refused without echoing what followed it.

Redaction replaces the token's text anywhere, so keep real tokens: a short test value such as
`abc` would also mask the letters `abc` in file names and messages.

## See also

- [Troubleshooting](troubleshooting.md).
- [Network](network.md): what the retry lines mean.
- [Exit codes](exit-codes.md).
