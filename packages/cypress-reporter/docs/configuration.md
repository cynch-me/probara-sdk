# Configuration

`@probara/cypress-reporter` reports a Cypress run to Probara. It registers in two places, and both
are needed for the full feature set:

```js
// cypress.config.js
const { defineConfig } = require('cypress');
const { probaraNodeEvents } = require('@probara/cypress-reporter/setup');

module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: { projectId: 'SHOP' },
    setupNodeEvents(on, config) {
      return probaraNodeEvents(on, config);
    },
  },
});
```

```js
// cypress/support/e2e.js
require('@probara/cypress-reporter/support');
```

The reporter reports every test of every spec, whatever the settings. The plugin (`setupNodeEvents`)
owns the Probara run and the `probara` task the browser's helpers use, and it takes the screenshots
and the video; the support file turns on the helpers (`probara.*`), the console capture and the run
selection. Without the plugin the run is still reported, one run per spec, and one warning names
what is missing; without the support file every helper does nothing, and one line on the browser
console says why.

## Options

Every option of [`@probara/core`](../core) under the same name (`apiToken`, `projectId`, `run`,
`resultsFile`, `statusMapping`, `statusFilter`, `createMissingCases`, `closeRun`,
`assignFailedTo`, `debug`, ...), each with its `PROBARA_*` variable, plus the ones below.

| Option               | Default | What it does                                                                                                                      |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `keyIncludesFile`    | `true`  | Start the automation key with the spec file, the `file` attribute of the root suite cypress-junit writes.                         |
| `captureOutput`      | `false` | Attach what each test writes to the browser console as `stdout.log` and `stderr.log`. Needs the support file.                     |
| `attachScreenshots`  | `true`  | Attach the screenshot Cypress takes on a failure to the result of that exact attempt.                                             |
| `attachVideos`       | `false` | Attach the video of the spec to every failed result of it. Needs `video: true`; the files are large.                              |
| `browserAsParameter` | `true`  | Send the browser Cypress runs (`electron`, `chrome`) as a `browser` parameter of every result. It never enters the key.           |
| `issueUrlTemplate`   | none    | The URL each `probara.issue(id)` becomes, with `%s` where the URL-encoded id goes. Without it, issues are dropped with a warning. |
| `runCasesOnly`       | `false` | Run only the tests of the cases of the run `run.ulid` (`PROBARA_RUN_ULID`); the others are skipped and left out of the report.    |

`reporterOptions` takes the object as written above, and the wrapper
`cypress-multi-reporters` uses (`{ '@probara/cypress-reporter': { ... } }`).

Every option can also be set with its environment variable (`PROBARA_CAPTURE_OUTPUT`,
`PROBARA_RUN_CASES_ONLY`, `PROBARA_ATTACH_VIDEOS`, ...), which is how a CI job configures a run
without touching the config.

## The console output of a test (`captureOutput`)

```json
{ "captureOutput": true }
```

With it on, the support file wraps `console.log`, `console.info` and `console.debug` (stdout) and
`console.warn` and `console.error` (stderr) for the time of each test. What the test wrote is
attached to that test's result as `stdout.log` and `stderr.log` (`text/plain`), one file per stream
per test, cut at 32 MiB with a line saying so. The browser console still prints everything, captured
or not.

Without the support file, nothing is captured and `captureOutput` has no effect.
