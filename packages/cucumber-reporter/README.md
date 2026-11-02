<p align="center">
  <a href="https://probara.net"><img src="https://raw.githubusercontent.com/cynch-me/probara-sdk/main/.github/assets/probara-mark.png" alt="Probara" width="120"></a>
</p>

<h1 align="center">@probara/cucumber-reporter</h1>

<p align="center">Every Cucumber scenario and step, live, in Probara: linked to its synced case.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@probara/cucumber-reporter"><img src="https://img.shields.io/npm/v/@probara/cucumber-reporter?style=flat-square&color=5b3fd6&logo=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@probara/cucumber-reporter"><img src="https://img.shields.io/npm/dm/@probara/cucumber-reporter?style=flat-square&color=5b3fd6" alt="npm downloads"></a>
  <a href="https://github.com/cynch-me/probara-sdk/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/cynch-me/probara-sdk/ci.yml?branch=main&style=flat-square&label=CI&logo=githubactions&logoColor=white" alt="CI status"></a>
  <a href="https://github.com/cynch-me/probara-sdk/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-5b3fd6?style=flat-square" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.12-5b3fd6?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22.12 or later">
  <img src="https://img.shields.io/badge/%40cucumber%2Fcucumber-13.3-5b3fd6?style=flat-square" alt="@cucumber/cucumber 13.3">
</p>

<p align="center">
  <a href="#quick-start"><b>Quick start</b></a>
  ·
  <a href="#documentation"><b>Documentation</b></a>
  ·
  <a href="https://probara.net"><b>Probara</b></a>
  ·
  <a href="https://github.com/cynch-me/probara-sdk"><b>Probara SDK</b></a>
</p>

A [Cucumber](https://cucumber.io) formatter (cucumber-js) that sends every scenario of a run to
[Probara](https://probara.net) as it finishes: each attempt with its steps, their keywords and data,
their errors and their attachments, keyed like the scenario's synced case. A scenario tagged
`@probara:SHOP-12` lands on that case. Cases that are missing get created, and the run is closed once
everything is in.

The formatter reads the feature files only for their keys: run [`probara sync gherkin`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/gherkin.md)
on the default branch so Git holds the cases, then this formatter reports the tests.

## Quick start

Install it next to cucumber-js:

```bash
npm install --save-dev @cucumber/cucumber @probara/cucumber-reporter
```

Set the token and the project in the environment of the job, and add the formatter to the
Cucumber configuration:

```js
// cucumber.js
module.exports = {
  default: {
    format: ['@probara/cucumber-reporter'],
    formatOptions: { probara: { projectId: 'SHOP' } },
  },
};
```

```bash
PROBARA_API_TOKEN=prb_… npx cucumber-js
```

Each run prints `[probara]` lines on stderr and nothing on stdout. cucumber-js gives stdout to one
formatter only, so this one replaces `progress`: to keep it, give this formatter a path, as in
`format: ['progress', '@probara/cucumber-reporter:reports/probara.txt']`
([where the output goes](docs/configuration.md#where-the-output-goes)). Reporting never changes the
exit code of the run: a run that passes still exits 0 when Probara cannot be reached.

## Documentation

- [Configuration](docs/configuration.md): every option, its `PROBARA_*` variable, and the token.
- [Linking](docs/linking.md): the key of a scenario, outlines, and `@probara:<ID>` tags.
- [Steps](docs/steps.md): keywords, Doc Strings and Data Tables, Background and hooks.
- [Attachments](docs/attachments.md): `this.attach`, `this.log` and `this.link`.
- [Statuses](docs/statuses.md) and [retries](docs/retries.md).
- [Runs](docs/runs.md) and [the results file](docs/results-file.md).
- [Troubleshooting](docs/troubleshooting.md), [coming from Qase](docs/migrating-from-qase.md).
- CI pipelines: [GitHub Actions](docs/ci/github-actions.md), [GitLab CI](docs/ci/gitlab.md),
  [Jenkins](docs/ci/jenkins.md), [CircleCI](docs/ci/circleci.md),
  [Azure Pipelines](docs/ci/azure-pipelines.md), [Bitbucket Pipelines](docs/ci/bitbucket.md) and
  [Buildkite](docs/ci/buildkite.md).

Sending a Cucumber JSON report instead, after the run, is the
[`probara import cucumber`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/gherkin.md#results-probara-import-cucumber)
command of [`@probara/cli`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/README.md),
for Cucumber-JVM, playwright-bdd and other tools that write that report.

## License

Apache-2.0. See [LICENSE](LICENSE).
