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

Each promise below names the tests that prove it.

- The `probara` command reads the token from the `PROBARA_API_TOKEN` environment variable only.
  There is no `--token` flag (a command line shows up in process lists and CI logs) and no config
  file (which could be committed by mistake). `@probara/core` takes it as the `apiToken` option or
  the same variable, so an adapter can read it from its own secret store. Proven by
  [`import-junit.test.ts`][cli-import] (no `--token` flag; exit 2 without the variable, even with
  every other setting given).
- It is sent only in the `Authorization` header, only to the configured base URL
  (`https://app.probara.net` by default), uploads included. Proven by
  [`client.test.ts`][core-client] (the headers of each request) and [`token.test.ts`][cli-token]
  (every request of an import with attachments goes to the base URL).
- Every log line, error message, `--json` document and dry-run line is redacted against it,
  server messages that echo it included. Proven by [`token.test.ts`][cli-token] (a server error
  echoing it, in stderr, stdout and `--json`; a report holding it, in the dry run),
  [`client.test.ts`][core-client], [`reporter.test.ts`][core-reporter],
  [`create-run.test.ts`][core-create] and [`close-run.test.ts`][core-close] (logs, errors and
  summaries, with the server echoing it). Every run with a token in
  [`import-junit.test.ts`][cli-import] and [`run-commands.test.ts`][cli-run] also checks that no
  output holds the token.
- Configuration errors name the variable at fault, never its value. Proven by
  [`config.test.ts`][core-config] (no reason, problem or warning echoes it) and
  [`import-junit.test.ts`][cli-import] (a `--token` value is not echoed).

[cli-import]: packages/cli/test/import-junit.test.ts
[cli-run]: packages/cli/test/run-commands.test.ts
[cli-token]: packages/cli/test/token.test.ts
[core-client]: packages/core/src/client.test.ts
[core-reporter]: packages/core/src/reporter.test.ts
[core-create]: packages/core/src/create-run.test.ts
[core-close]: packages/core/src/close-run.test.ts
[core-config]: packages/core/src/config.test.ts

What you can do:

- Keep the token in your CI's secret store, never in the repository or a pipeline file.
- Use an app token, created from the **JUnit XML** card in **Integrations**
  ([get a token](packages/cli/docs/configuration.md#get-a-token)). It can only report (create
  automated runs, send reports, upload result attachments, close runs), and it is not tied to a
  person, so nobody's own access is exposed with it. Revoke it from the same card when it may have
  leaked, and create a new one.
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
