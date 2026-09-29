# Network

The CLI talks HTTPS to one host, the base URL (`https://app.probara.net` by default). This page
covers timeouts, retries, the rate limit, idempotency, proxies and certificates.

## Timeouts

| Setting     | Default                            | Range       | What it bounds                                                    |
| ----------- | ---------------------------------- | ----------- | ----------------------------------------------------------------- |
| `--timeout` | 30000 ms                           | 1 to 600000 | One attempt of a request, the response body included              |
| uploads     | 120000 ms or `--timeout` if larger | —           | One attempt of an attachment upload (a large file on a slow link) |

A timed-out attempt is retried like a network error.

## Retries and backoff

| Answer                                                         | What happens                            |
| -------------------------------------------------------------- | --------------------------------------- |
| Network error, timeout, 408, 429, 500, 502, 503, 504           | Retried                                 |
| 409 with a `Retry-After` (the same request is still in flight) | Retried                                 |
| A `201` whose body never arrived                               | Retried; the idempotency key replays it |
| Any other answer (400, 401, 403, 404, 409, 413, 422...)        | Not retried: the request fails          |

- `--max-retries` (0 to 10, default 4) sets the retries after the first attempt: 5 attempts in all
  by default.
- The wait before retry `n` is 1 s × 2ⁿ⁻¹, at most 30 s, plus up to 20 % of random jitter.
- A `Retry-After` header (seconds or an HTTP date) replaces that wait, capped at 120 s.
- Each retry is logged: `Report attempt 1 of 5 got 503; retrying in 1043 ms`.

With the defaults, a report that keeps failing gives up after about 15 s of waiting, plus the
attempts themselves.

## Rate limit

Probara limits API requests per organization (60 requests per minute by default), for every token
of the organization together. What an import costs:

| Request           | How many                                                                   |
| ----------------- | -------------------------------------------------------------------------- |
| Report            | 1 per chunk of up to 500 results (`--chunk-size`)                          |
| Attachment stage  | 1 per result with files (per 20 files or 64 MiB)                           |
| Attachment commit | 1 per result with files                                                    |
| Close             | 1, when attachments were queued (otherwise the last report closes the run) |

An import of 2000 results without attachments costs 4 requests; one where 100 results have
screenshots costs about 200 more. `429` answers are retried after their `Retry-After`. See
[429 Too many requests](troubleshooting.md#probara-answers-429-too-many-requests) for what to tune.

## Chunks and ordering

- Results go out in chunks of `--chunk-size` (1 to 500, default 500), **one after another**, in
  the order of the files and testcases. A run case keeps the last outcome recorded, so the order
  matters.
- The first chunk creates the run (unless `--run-ulid` names one); the others reuse it.
- When a chunk fails after its retries, the later chunks are not sent and the run is left open
  (`partial`, exit 1).
- The last chunk closes the run. With attachments, the run is closed after the uploads instead.
- Uploads start once the reports are in, `--attachment-concurrency` results at a time (1 to 8,
  default 2).

## Idempotency

Every report, run creation, run close and attachment commit carries an `Idempotency-Key`, the same
on each retry of that request. A retried report whose first attempt was recorded after all is
replayed by Probara, never recorded twice. Attachment stage requests carry none: a staged file
that is never committed expires.

Running the **command** again is a new import: new keys, a new run (unless `--run-ulid`), and
every result recorded again.

## Proxies

The CLI uses Node's built-in `fetch`, and has no proxy option of its own:

| Node.js                     | Proxy support                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------- |
| 22.21 or later, 24 or later | Set `NODE_USE_ENV_PROXY=1` with `HTTPS_PROXY` (and `NO_PROXY`); `fetch` goes through it |
| 22.12 to 22.20              | Not supported: `fetch` ignores `HTTPS_PROXY` and `HTTP_PROXY`                           |

```bash
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://proxy.example.com:8080 probara import junit junit.xml
```

Node added `fetch` support for `NODE_USE_ENV_PROXY` in
[22.21.0](https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V22.md#22.21.0) and
24.0.0 ([Node's docs](https://nodejs.org/api/cli.html#node_use_env_proxy1)). It is marked "active
development" there. On older Node versions, upgrade Node or allow the base URL through the firewall.

## Custom certificate authorities

For a self-hosted Probara behind a private certificate authority, give Node the CA certificate
(PEM) when it starts:

```bash
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/company-ca.pem probara import junit junit.xml
```

Node reads `NODE_EXTRA_CA_CERTS` once at startup, so set it in the environment of the step, not
inside the tool. On Node 22.19 and later, `NODE_USE_SYSTEM_CA=1` trusts the operating system's
certificate store instead. There is no option to turn TLS verification off.

## See also

- [Configuration](configuration.md#self-hosted-probara-and-the-base-url): the base URL.
- [Troubleshooting](troubleshooting.md).
- [`@probara/core` failure behavior](../../core/README.md#failure-behavior).
