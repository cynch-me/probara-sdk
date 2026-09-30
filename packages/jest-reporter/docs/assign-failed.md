# Assign failed results

`assignFailedTo` names the people who look into failures. Every report asks Probara to assign each
run case it leaves failed, and that has no assignee yet, to one of them, in turn, so a failing
nightly run lands on someone's list without anyone triaging it first.

<!-- project: assign, exit: 1 -->

```js
reporters: [
  'default',
  [
    '@probara/jest-reporter',
    { assignFailedTo: ['ana@example.com', 'bo@example.com', 'cy@example.com'] },
  ],
],
```

<!-- project: assign -->

```js
// tests/checkout.test.js
test('pays with a card', () => {
  expect('declined').toBe('paid');
});

test('pays with a voucher', () => {
  expect(0).toBe(25);
});

test('shows the total', () => {});
```

With `ana@example.com` and `bo@example.com` members of the project and `cy@example.com` not, the two
failed cases go to Ana and Bo, and Probara says one email matched no one:

<!-- output: assign, scenario: members -->

```text
$ npx jest
[probara] Sending 3 results of 3 tests (1 passed, 2 failed, 0 skipped, 0 blocked)
[probara] Probara warned: assignFailedTo: 1 of 3 emails did not match a member who can be assigned in this project
[probara] Recorded 3 results (3 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

Or from the environment: `PROBARA_ASSIGN_FAILED_TO=ana@example.com,bo@example.com`.

## Rules

| Rule                                                      | Why                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| Only run cases a report leaves `failed`                   | Passed, skipped and blocked results need no one                 |
| Only run cases without an assignee                        | An existing assignee is never replaced: someone already owns it |
| Only active members who can run tests in the project      | A case cannot be assigned to someone who cannot work on it      |
| The listed members take turns, in the order you list them | Failures are spread, not piled on the first name                |
| An email that matches no such member is skipped           | The results are still recorded; Probara's warning counts them   |

- **After `statusMapping`.** The status that counts is the one Probara records: with
  `statusMapping: { failed: 'blocked' }`, nothing is failed, so nothing is assigned.
- **The warning never names the emails**, only how many were skipped: the log of a CI job is not the
  place to list who is or is not a member. Check the list against the project's members in
  Probara.
- **Turns start again with every report**: each report (a chunk of up to 500 results, a shard, a
  watch re-run) gives its first failed case to the first member listed.
- **Every report of the run asks**, with the same list: a run with [several Probara
  projects](projects.md#several-probara-projects) asks in each project's run, and the shards of a
  [shared run](ci/sharding.md) each assign the cases they leave failed.
- **A results file keeps the list.** `probara import results` sends it with the results, unless
  `--assign-failed-to` or `PROBARA_ASSIGN_FAILED_TO` names others
  ([results file](results-file.md)).

## See also

- [Configuration](configuration.md#options): `assignFailedTo`.
- [Coming from other tools](coming-from-other-tools.md): TestRail's `--assign`.
