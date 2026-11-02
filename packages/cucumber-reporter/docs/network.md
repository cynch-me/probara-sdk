# Network

The formatter sends its reports and attachments over HTTPS to `baseUrl` (`PROBARA_BASE_URL`, default
`https://app.probara.net`). A failed request is retried with a backoff, and a request that still fails
is logged and counted in the summary: the run never stops for it.

- `timeoutMs`: the timeout of one HTTP attempt, 1 to 600000 ms, default 30000.
- `maxRetries`: how many times a failed request is retried, 0 to 10, default 4. Set `0` to fail fast
  when Probara is unreachable: the results are then kept in the [results file](results-file.md) when
  one is set.
- `chunkSize`: results per report request, 1 to 500, default 500.
- `attachmentConcurrency`: attachments uploaded at the same time, 1 to 8, default 2.
- `uploadAttachments`: `false` sends no file.

A proxy or a self-hosted Probara works the same way: set `baseUrl` to its address.
