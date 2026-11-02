# Coming from Qase's cucumber-js reporter

[`qase-cucumberjs`](https://github.com/qase-tms/qase-javascript/tree/main/qase-cucumberjs) links a
scenario to a Qase case with a tag, and sends its results to Qase. This formatter does the same for
Probara, with two differences: the scenarios come from Git through `probara sync gherkin`, and the
link is the `@probara:<ID>` tag.

| What              | Qase                                             | Probara                                                 |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------- |
| Package           | `qase-cucumberjs`                                | `@probara/cucumber-reporter`, with `@cucumber/cucumber` |
| Link a scenario   | `@QaseID=12`                                     | `@probara:SHOP-12` (the case's display ID)              |
| Token and project | `QASE_TESTOPS_API_TOKEN`, `QASE_TESTOPS_PROJECT` | `PROBARA_API_TOKEN`, `PROBARA_PROJECT`                  |
| Cases             | created by the reports                           | synced from the feature files, then linked by key       |
| Attachments       | sent by the reporter                             | sent by the reporter, with `this.attach` and `this.log` |

## Steps

1. Remove `qase-cucumberjs` and its entry from `cucumber.js`.
2. Install the formatter: `npm install --save-dev @probara/cucumber-reporter`.
3. Add it to `format` and set `projectId` in `formatOptions.probara`, as the
   [quick start](../README.md#quick-start) shows.
4. Replace each `@QaseID=<n>` tag with `@probara:<ID>`, using the case's display ID in Probara. The
   tag is not a tag of the case: it only links the scenario.
5. Sync the feature files on the default branch: `npx @probara/cli sync gherkin "features/**/*.feature"`.
   A scenario then lands on its case by its key, even before it has a tag.
