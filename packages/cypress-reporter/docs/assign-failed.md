# Assign failed results

`assignFailedTo` gives every failed result of a run an owner, so a failure lands on a person instead
of on a queue nobody watches.

```js
// cypress.config.js
module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: {
      projectId: 'SHOP',
      assignFailedTo: ['ana@example.com', 'bo@example.com'],
    },
    setupNodeEvents(on, config) {
      return probaraNodeEvents(on, config);
    },
  },
});
```

```bash
PROBARA_ASSIGN_FAILED_TO=ana@example.com,bo@example.com npx cypress run
```

Nothing else changes: the assignment happens where the results are recorded, in the same request.

## What is assigned, and how

- Every run case this report leaves **`failed`** and that **has no assignee** is assigned to one of
  the emails, **round-robin in the order given**. The round-robin starts again with the first email
  in every report, so the spread is stable across runs rather than drifting.
- An **assignee is never overwritten**: a case someone already owns keeps its owner.
- It happens in the same transaction as the results, so a case is never assigned without its result.
- It never fails a report: an email that cannot be assigned is counted in a warning from Probara.

## With retries, the last outcome decides

The run case keeps the outcome of its **last** attempt ([retries](retries.md)), and assignment
follows what the case is left as:

| The run left the case as                                | Assigned?                    |
| ------------------------------------------------------- | ---------------------------- |
| `failed`                                                | Yes, when it has no assignee |
| `passed` (it failed, then passed on a retry)            | No: the case is passed       |
| `skipped`                                               | No                           |
| `blocked` (with `statusMapping: { failed: 'blocked' }`) | No: the case is not `failed` |

A flaky test that passes on its retry is therefore never assigned, however many of its attempts
failed: the assignment is per run case, not per attempt.

## An email that cannot be assigned

Probara counts an email it could not use and warns, without naming which ones, so the addresses are
never echoed back:

```text
[probara] Probara warned: <message from Probara>
```

An email is not usable when it is not an **active member** whose role can run tests and who can
access the project; a member with a custom role is skipped. The report is still recorded, and the
rest of the run is unaffected.

## The list

The list is trimmed, deduplicated case-insensitively, and blank entries are dropped. Two mistakes
turn reporting off, naming the option:

| Problem                                             | Why                                                       |
| --------------------------------------------------- | --------------------------------------------------------- |
| `assignFailedTo holds a value that is not an email` | An address that is not an email of at most 254 characters |
| `assignFailedTo holds more than 20 emails`          | The list holds at most 20 members                         |

Both are [configuration problems](troubleshooting.md#reporting-is-off-a-configuration-problem), and
they are the only thing about this option that stops a run from reporting: everything else about an
assignment is decided by Probara.

## See also

- [Statuses](statuses.md): what a result carries, and what `statusMapping` changes.
- [Retries](retries.md): the outcome a run case ends with.
- [Configuration](configuration.md#assign-failed-results): the option and its variable.
