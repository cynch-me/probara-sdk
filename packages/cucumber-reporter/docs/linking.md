# Linking

A result reaches a Probara case in one of two ways: its **automation key** matches the key of a
synced case, or its scenario carries a **`@probara:<ID>` tag** that names the case. Both are the
rules `probara sync gherkin` uses, so a scenario that is synced once and reported many times always
lands on the same case.

## The key

A scenario's key is `<path> > <Feature> > <Scenario>`, the same as `probara sync gherkin` builds:

- `<path>` is the feature file relative to `rootDir` (the directory Cucumber runs in, unless you set
  it), with `/` separators, such as `features/checkout/pay.feature`.
- The key is [key v1](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#the-automation-key-v1),
  the automation key of every Probara reporter.
- A `Rule:` is not part of the key: a scenario under a Rule is keyed under its Feature.
- A Scenario Outline has one key, with its placeholders as written: `Pay with <method>`. Each row of
  its Examples is a separate result. Its values are the result's parameters (`method: visa`), and
  they are not part of the key.
- The key uses the names as written in the feature file, and the file's path. Renaming a file, its
  Feature or a scenario changes its key: sync the change, and the case moves with it when
  `probara sync gherkin` finds it (see the [sync guide](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/gherkin.md#moves-and-bindings)).

Run the formatter from the directory the feature paths are relative to, or set `rootDir` to the
repository root. The sync and the formatter must agree on that root, or the keys differ.

## Case tags

A scenario tagged `@probara:<ID>` reports to the case with that display ID, whatever its key:

```gherkin
@probara:SHOP-12
Scenario: Pay with the saved card
```

- Only the scenario's own tags count. A tag on its Feature or Rule does not apply to its scenarios.
- Several tags link the result to several cases: one result is sent to each case.
- A tag whose ID is not a display ID (such as `@probara:shop-3`) is ignored, with a warning on stderr.
- The case must belong to the project of the run, or to a project listed in `projects`. Another
  project's case is not reported to (core drops it, with a count in the summary).
- Other tools' tags (`@TEST_ABC-12`, `@QaseID=12`, `@C123`) link nothing.

## Scenarios without a synced case

A result whose key matches no case creates a case, as every report does (`createMissingCases`, on by
default). The case is then the one `probara sync gherkin` would also find by its key, once the
scenario is synced. Sync before the tests so that results land on the synced cases.

## Checking the link

After a run, the case of each scenario shows the run's result. If a result lands on a new case
instead, the sync has not run since the scenario was renamed, or the formatter and the sync use
different roots.
