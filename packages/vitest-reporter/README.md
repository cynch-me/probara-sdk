# @probara/vitest-reporter

The Vitest reporter for [Probara](https://probara.net). It sends every test result of a Vitest run to Probara.

## Quick start

Register the reporter in `vitest.config.mts`:

```ts
reporters: ['default', ['@probara/vitest-reporter', { projectId: 'SHOP' }]],
```

Set the token in the environment, then run the tests as you do now:

```bash
PROBARA_API_TOKEN=prb_live_xxxxxxxx npx vitest run
```

A run reports its results and logs what it did on stderr:

<!-- output: default -->

```
$ npx vitest run
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

A test that attaches a file sends it with its result:

<!-- project: attach -->

```ts
// tests/attach.test.ts
import { probara } from '@probara/vitest-reporter';
import { expect, it } from 'vitest';

it('attaches the receipt', async () => {
  await probara.attach({ name: 'receipt', body: 'paid 12.00', contentType: 'text/plain' });
  expect(1).toBe(1);
});
```

<!-- files: attach -->

```
receipt.txt text/plain
```

The results of the default tests, as Probara receives them:

<!-- sent: default -->

```json
[
  {
    "automationKey": "tests/cart.test.ts > cart > adds an item",
    "status": "passed",
    "caseDisplayId": "SHOP-12"
  },
  {
    "automationKey": "tests/cart.test.ts > cart > removes an item",
    "status": "passed"
  },
  {
    "automationKey": "tests/login.test.ts > login > logs in with a valid password",
    "status": "passed"
  }
]
```

A watch session reports each re-run:

<!-- output: default, scenario: watch -->

```
$ npx vitest --watch
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (open): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Watch mode: every re-run reports into R-1 of SHOP, which stays open: close it in Probara, or with probara run close --project SHOP --run-ulid <ULID>
[probara] Sending 2 results of 2 tests (2 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 2 results (0 new cases, 0 unmatched) in R-1 (open): https://app.probara.net/projects/SHOP/runs/R-1
```

A sharded CI job writes one blob per shard, and one run merges them:

```bash
npx vitest run --shard=1/2 --reporter=blob
npx vitest run --shard=2/2 --reporter=blob
npx vitest --merge-reports
```
