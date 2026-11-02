# Statuses

Every result has one of four statuses: `passed`, `failed`, `skipped` or `blocked`. The formatter
sends `passed`, `failed` and `skipped`; `blocked` comes from [status mapping](#status-mapping-and-filter).

## Step statuses

| Cucumber's status                            | Probara's status | Why                                                                       |
| -------------------------------------------- | ---------------- | ------------------------------------------------------------------------- |
| `passed`                                     | `passed`         | The step ran and passed.                                                  |
| `failed`                                     | `failed`         | The step ran and failed. Its message is the step's error.                 |
| `ambiguous`                                  | `failed`         | More than one definition matches the step. Its message says so.           |
| `skipped`, `pending`, `undefined`, `unknown` | `skipped`        | The step did not run: it is skipped, or has no definition, or is pending. |

Cucumber's report spells these in lowercase (its JSON report) or in uppercase (its Messages); the
formatter reads both.

## Scenario statuses

A scenario, or one row of an outline, is:

1. `failed` when any of its steps failed, or any of its `Before` or `After` hooks failed;
2. otherwise `skipped` when any of its steps did not run;
3. otherwise `passed`.

## Status mapping and filter

`statusMapping` sends a status as another, and `statusFilter` leaves results with those statuses out
of the report, after the mapping. For example, `PROBARA_STATUS_MAPPING=failed=blocked` and
`PROBARA_STATUS_FILTER=skipped` send every failed scenario as blocked and send no skipped one.

## Durations

A step's duration is its own. A scenario's duration is the sum of its steps and hooks, in
milliseconds. The start of each attempt is sent as its `executedAt`.
