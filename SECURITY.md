# Security policy

## Supported versions

Nothing is published on npm yet. Once `@probara/cli` and `@probara/core` are published, security
fixes go to the latest release of each package; while they are 0.x, only the latest minor version
is supported.

| Package         | Supported                 |
| --------------- | ------------------------- |
| `@probara/cli`  | latest release (none yet) |
| `@probara/core` | latest release (none yet) |

## Reporting a vulnerability

Report it privately by email to the maintainer, **gustavo@cynch.me**. Do not open a public issue
or pull request for it.

Please include:

- the package and version (or commit) affected,
- what an attacker can do, and the steps or a proof of concept to reproduce it,
- whether it is already known or disclosed anywhere.

You will get a reply by email. The fix is prepared privately, then released with a note in the
package's changelog; you are credited unless you prefer not to be.

## How the tools handle the API token

- The token is read from the `PROBARA_API_TOKEN` environment variable only. There is no `--token`
  flag (a command line shows up in process lists and CI logs) and no config file (which could be
  committed by mistake).
- It is sent only in the `Authorization` header, only to the configured base URL
  (`https://app.probara.net` by default).
- Every log line, error message, `--json` document and dry-run line is redacted against it,
  server messages that echo it included. Configuration errors name the variable at fault, never its
  value.

What you can do:

- Keep the token in your CI's secret store, never in the repository or a pipeline file.
- Use a token whose user has only the permissions reporting needs (run tests and write test
  cases in the project), and rotate it when someone who could read it leaves.
- Do not hand secrets to builds of pull requests from forks: each
  [CI guide](packages/cli/README.md#documentation) shows how to skip reporting there instead.

## What the tools send

To the base URL, and nowhere else (no telemetry, no update checks):

- The run: its name, tags, environment, milestone and configurations, and its source: branch,
  commit and CI build URL, read from the CI's variables.
- Each result: status, title, automation key and suite path (built from test names, class names
  and file paths relative to the working directory), case ids, duration, execution time, and
  notes: failure messages and stack traces, which can hold file paths and values from assertions.
- Attachments: the files the reports reference, and each test's output with `--attach-output`.
- A `User-Agent` naming the tool and Node.js versions, such as
  `probara-cli/0.1.0 probara-core/0.1.0 node/22.12.0`.

Review what a report holds with `probara import junit <files> --dry-run --json` before sending it.
