# Probara Snap

Probara Snap compares screenshots of your pages between commits. A test takes them with
`probaraSnap`, and the reporter uploads them at the end of the run as one build of the commit.
Probara compares each one with its baseline and shows the changes for review. A change never fails
the test or the run.

## Take a screenshot

<!-- project: snap -->

```ts
// tests/checkout.spec.ts
import { test } from '@playwright/test';
import { probaraSnap } from '@probara/playwright-reporter';

test('checkout', async ({ page }) => {
  await page.goto('/checkout');
  await probaraSnap(page, 'checkout');

  await page.getByRole('button', { name: 'Pay' }).click();
  await probaraSnap(page, 'checkout-paid', { fullPage: true, mask: ['.order-number'] });
});
```

The last log line of the run is the page of the build:

<!-- output: snap, scenario: snap -->

```text
$ npx playwright test
[probara] Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 1 result (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Sent 2 screenshots to the Snap build #1 (2 new files): https://app.probara.net/projects/SHOP/snap/01JD2K7M9Q4V6X8Z0B3C5E7G9H
```

A file Probara already holds is not uploaded again, so a run whose pages did not change uploads
nothing new.

## Names

A screenshot is identified by its test, its name, the browser, the viewport and the color scheme:
the same name in Chromium and in Firefox, or in the light and the dark scheme, is two screenshots.

- A name must be unique within a test. Using one twice fails the test with
  `probaraSnap(): the name "checkout" is already used in this test`.
- Two tests may take the same name: each keeps its own screenshot.
- A retried test takes its screenshots again: only those of its last attempt are sent.

Each screenshot is linked to its test, and to the cases the test links
([linking](linking.md)).

Each screenshot also carries what Probara shows beside it: the reporter and its version,
`@playwright/test` and its version, the browser version, the page's URL when it is an `http` or
`https` URL, where the test is declared (file, line and column), its retry and its `retries`,
its annotations and its tags. A URL is sent as the page has it, query string included: keep secrets
out of the URLs of the pages you capture.

## What `probaraSnap` does before the capture

It waits for the fonts of the page, stops CSS animations and transitions, and hides the text caret.
The page is left as it was once the screenshot is taken. Wait for your own content (images, data)
before calling it, as before any screenshot.

## Options

| Option      | Type                    | Default           | What it does                                                            |
| ----------- | ----------------------- | ----------------- | ----------------------------------------------------------------------- |
| `fullPage`  | `boolean`               | `false`           | Take the whole scrollable page instead of the viewport                  |
| `mask`      | `(string \| Locator)[]` | none              | Paint a box over these elements                                         |
| `hide`      | `string[]`              | none              | Make the elements of these CSS selectors invisible, keeping their space |
| `remove`    | `string[]`              | none              | Take the elements of these CSS selectors out of the layout              |
| `threshold` | `number`                | Probara's default | How different two pixels must be to count as a change, from 0 to 1      |

Masking happens in the browser, before the capture. To mask or hide an element from the markup
instead of from every test, give it an attribute: `<time data-probara-snap-hide>` is hidden and
`<img data-probara-snap-mask>` is masked in every screenshot.

## The commit and the branch

A build belongs to a commit and a branch, read from the CI
([run options](runs.md#run-source)). On a GitHub Actions `pull_request` event the commit
is the head of the pull request, not the merge commit GitHub checks out, and the base branch and
the pull request number are sent too. A GitHub merge queue run (`merge_group`) sends its queue
branch as it is, with the branch it merges into as the base branch and the number of its pull
request. Outside a known CI, set `PROBARA_COMMIT` (the full
40-character SHA) and `PROBARA_BRANCH`.

One run sends one build, named `default`. To send several builds for one commit (a desktop and a
mobile suite, say), give each `playwright test` its own `snapBuildName`
(`PROBARA_SNAP_BUILD_NAME`).

## The baseline

Probara compares a build with a baseline build of an earlier commit, which it picks from the git
history: the reporter sends the merge base of the commit and the base branch of its pull request, then
its ancestors, at most 300 (on a push without a pull request, the commit and its ancestors). It
reads them from the checkout and fetches more history from `origin` when the clone is shallow, so
the CI checkout needs no `fetch-depth: 0`. When git is missing or the history cannot be read, the
build is still sent, without them: Probara then only takes an approved build of the same commit and
branch as its baseline.

On GitHub, Probara posts the outcome of the comparison as a status on the commit. To gate another
CI on it, run
[`probara snap wait --fail-on-changes`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#probara-snap-wait)
in a job after the tests.

## Sharded runs

Each shard uploads its own screenshots, and the shards of one CI run join one build, which is
complete once every shard sent its part. They find each other by a nonce the reporter reads from
the CI: the run id and attempt on GitHub Actions, the pipeline id on GitLab CI, CircleCI (the
workflow id), Azure Pipelines, Jenkins, Bitbucket Pipelines and Buildkite. On another CI, set
`PROBARA_SNAP_NONCE` to the same value in every shard, and to a new one in every run.

Turn the `snap` option on in every shard (`snap: true`, or `PROBARA_SNAP=true`):

```ts
reporter: [['list'], ['@probara/playwright-reporter', { snap: true }]],
```

With it, a shard that takes no screenshot still tells Probara it is done, so the build does not wait
for it. Without it, a shard sends only the screenshots it took and the reporter warns that the build
may never complete; a run that takes no screenshot sends nothing to Probara Snap. A run without
shards does not need the option.

A `--shard` run carries its total, so the build completes with its last shard:
[`probara snap finalize`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#probara-snap-finalize)
is not needed. That command is for Cypress machines, which join a build without a total.

## Failure screenshots

The screenshots Playwright takes on failure (`screenshot: 'only-on-failure'`) and the files a test
attaches stay [attachments](attachments.md) of the result. Only `probaraSnap` sends screenshots to
Probara Snap, and they are not attached to the result.

## When the upload fails

Like every reporting problem, a failed upload is logged and never changes Playwright's exit code.
Each plan includes a number of Snap screenshots per month; once it is used up, Probara refuses the
screenshots of the job and the log says so:

<!-- output: snap, scenario: snap-limit -->

```text
$ npx playwright test
[probara] Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 1 result (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Could not send the Snap screenshots: Probara answered 409 snap_screenshot_limit_reached: <message from Probara>
```

The test results are recorded all the same.
