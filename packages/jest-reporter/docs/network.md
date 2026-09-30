# Network

The reporter talks HTTPS to one host, the base URL (`https://app.probara.net` by default), from
Jest's main process: the test workers never call Probara. This page covers what it sends and when,
timeouts, retries, the rate limit, idempotency, proxies and certificates.

## When requests happen

| When                                              | Requests                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Before the tests start, only with `runCasesOnly`  | `GET` the case keys of the run, 200 cases per page until the last page            |
| After the last test file (Jest's `onRunComplete`) | The reports, then the attachment uploads, then the close of the run (when needed) |

Nothing is sent while the tests run: the reporter collects the results and sends them once Jest
is done. Jest waits for the reporter before it exits (with `--forceExit` too), so the time the
requests take, retries included, is part of the `jest` command.

With `runCasesOnly`, the case keys are read once per `jest` (and once per re-run in watch mode).
When they cannot be read after the retries, every test runs and is reported, with one warning
([run selection](run-selection.md)); the retries of that read are logged at debug only.

## Timeouts

| Option      | Default                            | Range       | What it bounds                                                    |
| ----------- | ---------------------------------- | ----------- | ----------------------------------------------------------------- |
| `timeoutMs` | 30000 ms                           | 1 to 600000 | One attempt of a request, the response body included              |
| uploads     | 120000 ms or `timeoutMs` if larger | —           | One attempt of an attachment upload (a large file on a slow link) |

A timed-out attempt is retried like a network error.

## Retries and backoff

| Answer                                                         | What happens                            |
| -------------------------------------------------------------- | --------------------------------------- |
| Network error, timeout, 408, 429, 500, 502, 503, 504           | Retried                                 |
| 409 with a `Retry-After` (the same request is still in flight) | Retried                                 |
| A `201` whose body never arrived                               | Retried; the idempotency key replays it |
| Any other answer (400, 401, 403, 404, 409, 413, 422...)        | Not retried: the request fails          |

- `maxRetries` (0 to 10, default 4) sets the retries after the first attempt: 5 attempts in all by
  default.
- The wait before retry `n` is 1 s × 2ⁿ⁻¹, at most 30 s, plus up to 20 % of random jitter.
- A `Retry-After` header (seconds or an HTTP date) replaces that wait, capped at 120 s.
- Each retry is logged, with the attempt and the wait.

With the defaults, a report that keeps failing gives up after about 15 s of waiting (1 + 2 + 4 +
8 s, up to 18 s with the jitter), plus the attempts themselves, each at most `timeoutMs` (30 s by
default). The worst case is a `Retry-After` on every answer: 120 s before each retry, so 8 minutes
of waiting with the default 4 retries (20 minutes with `maxRetries: 10`), plus up to 5 attempts of
30 s. That is per request, and a failed report stops the later ones of its project. Jest waits for
the reporter before it exits: lower `maxRetries` or `timeoutMs` to bound a CI step.

## Rate limit

Probara limits API requests per organization (60 requests per minute by default), for every token
of the organization together. What a run costs:

| Request           | How many                                                                   |
| ----------------- | -------------------------------------------------------------------------- |
| Case keys         | 1 per 200 cases of the run, only with `runCasesOnly`                       |
| Report            | 1 per chunk of up to 500 results (`chunkSize`)                             |
| Attachment stage  | 1 per result with files (per 20 files or 64 MiB)                           |
| Attachment commit | 1 per result with files                                                    |
| Close             | 1, when attachments were queued (otherwise the last report closes the run) |

A run of 2000 attempts without files costs 4 requests; one where 100 attempts attach a file (or
their console output, with `captureOutput`) costs about 200 more. `429` answers are retried after
their `Retry-After`. To spread uploads, lower `attachmentConcurrency`; to send fewer files, attach
only what matters, or set `uploadAttachments: false`.

## Chunks and ordering

- Results go out in chunks of `chunkSize` (1 to 500, default 500), **one after another**, in the
  order Jest ended the test files, each file's attempts in order. A run case keeps the last
  outcome recorded, so the order matters. A chunk also stays within Probara's totals of steps and
  tags per report.
- The first chunk creates the run (unless `run.ulid` names one); the others reuse it.
- When a chunk fails after its retries, the later chunks of that project are not sent and the run is
  left open; a [results file](results-file.md) keeps them.
- Uploads start once their report is recorded, `attachmentConcurrency` results at a time (1 to 8,
  default 2), and the run is closed after the uploads.

## Idempotency

Every report, run creation, run close and attachment commit carries an `Idempotency-Key`, the same
on each retry of that request. A retried report whose first attempt was recorded after all is
replayed by Probara, never recorded twice. Running `jest` again is a new run, with every result
recorded again.

## Proxies

The reporter uses Node's built-in `fetch`, and has no proxy option of its own:

| Node.js                     | Proxy support                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------- |
| 22.21 or later, 24 or later | Set `NODE_USE_ENV_PROXY=1` with `HTTPS_PROXY` (and `NO_PROXY`); `fetch` goes through it |
| 22.12 to 22.20              | Not supported: `fetch` ignores `HTTPS_PROXY` and `HTTP_PROXY`                           |

```bash
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://proxy.example.com:8080 npx jest
```

Node added `fetch` support for `NODE_USE_ENV_PROXY` in
[22.21.0](https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V22.md#22.21.0) and
24.0.0 ([Node's docs](https://nodejs.org/api/cli.html#node_use_env_proxy1)). The variables reach
Jest's workers too: put `localhost` in `NO_PROXY` if your tests reach a local server through
`fetch`. On older Node versions, upgrade Node or allow the base URL through the firewall.

## Custom certificate authorities

For a self-hosted Probara behind a private certificate authority, give Node the CA certificate
(PEM) when it starts:

```bash
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/company-ca.pem npx jest
```

Node reads `NODE_EXTRA_CA_CERTS` once at startup, so set it in the environment of the step. On
Node 22.19 and later, `NODE_USE_SYSTEM_CA=1` trusts the operating system's certificate store
instead. There is no option to turn TLS verification off.

## See also

- [Configuration](configuration.md#self-hosted-probara): the base URL.
- [Troubleshooting](troubleshooting.md).
- [`@probara/core` failure behavior](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#failure-behavior).
