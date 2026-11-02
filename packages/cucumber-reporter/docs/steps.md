# Steps

Each step a scenario runs is one step of its result, in the order the feature file gives them.

| Step field   | What it holds                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `keyword`    | `Given`, `When`, `Then`, `And`, `But` or `*`, as written. A step written in another language has none. |
| `action`     | The step text. In an outline row, the values of that row are filled in.                                |
| `status`     | [Its status](statuses.md#step-statuses), from Cucumber's result of the step.                           |
| `durationMs` | The step's duration in milliseconds.                                                                   |
| `error`      | The message of a failed step: Cucumber's error text. An ambiguous step with no message says why.       |
| `data`       | A Doc String's content, or a Data Table as lines of pipes (`\| item \| price \|`).                     |

```gherkin
When the customer sends the receipt:
  """
  Thank you for the order.
  """
Then the receipt table is:
  | item | price |
  | book | 12    |
```

sends `data` of `Thank you for the order.` on the first step, and `| item | price |\n| book | 12 |` on
the second.

## Background

The Background steps of a scenario sit under one `Background` step, with their own steps nested in it.
Its status is the rollup of its steps, and its duration is their sum. A Background of a Rule applies
to the scenarios under the Rule, and sits in the same way.

## Hooks

Hooks (`Before` and `After`) are not steps: they are not sent. A hook that fails fails its scenario,
and its message is the scenario's error, or `The hook failed` when it has none. Its duration counts
in the scenario's duration.

## Steps that did not pass

- A step that failed, or is ambiguous (more than one definition matches it), fails its scenario.
- An undefined or pending step did not run: it is `skipped`, and so is the scenario, unless a step
  failed.
- The steps after a failed step did not run, so they are `skipped`.

See [statuses](statuses.md) for the rules in full.
