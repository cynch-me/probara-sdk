// Cypress's built-in `junit` reporter (the mocha-junit-reporter 2.2.0 that Cypress 16.1.1 bundles)
// with its default options, plus `includePending` so the skipped tests are in the report. The
// reporter deletes and rewrites mochaFile for every spec, so mochaFile has the [hash] the reporter
// replaces with a digest of the XML it writes; one name would keep only the last spec. generate.sh
// renames each file after the spec it holds and copies it next to this folder.
const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    supportFile: false,
  },
  video: false,
  screenshotOnRunFailure: false,
  reporter: 'junit',
  reporterOptions: {
    mochaFile: 'junit-[hash].xml',
    includePending: true,
  },
});
