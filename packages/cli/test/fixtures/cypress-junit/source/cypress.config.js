// cypress-junit with its default options, plus `includePending` so the skipped tests are in the
// report. mochaFile has the [hash] the reporter replaces with a digest of the XML it writes:
// cypress-junit deletes and rewrites the file for every spec, so one name would keep only the last
// spec. generate.sh renames each file after the spec it holds and copies it next to this folder.
const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    supportFile: false,
  },
  video: false,
  screenshotOnRunFailure: false,
  reporter: 'cypress-junit',
  reporterOptions: {
    mochaFile: 'junit-[hash].xml',
    includePending: true,
  },
});
