# Interactive mode

**`cypress open` reports nothing.** Only `cypress run` sends results to Probara. Run the specs you
are working on with `cypress run --spec` to report them:

```bash
PROBARA_API_TOKEN=… PROBARA_PROJECT=SHOP npx cypress run --spec 'cypress/e2e/cart.cy.js'
```

## Why

| What the reporter needs                                   | In `cypress open`                                                                                                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The reporter (`reporter`), which turns tests into results | Not built: Cypress uses `reporter` [during `cypress run` only](https://docs.cypress.io/app/references/configuration#Global); the app shows its own command log |
| `before:spec`, `after:spec` and `after:run`               | Fired only with `experimentalInteractiveRunEvents`, and [without their results](https://docs.cypress.io/api/node-events/after-spec-api)                        |

With no reporter there is nothing to send, whatever the plugin receives. A `cypress open` session
with the reporter, the plugin and the support file registered runs its tests as usual, and creates
no run in Probara.

## Several local runs, one Probara run

To collect a few local `cypress run` commands in one run, create it once and pass its ULID to each,
as the [machines of a sharded job](ci/sharding.md) do; a run the reporter did not create is never
closed by it:

```bash
PROBARA_RUN_ULID=$(npx @probara/cli run create --run-name "Cart rework")
export PROBARA_RUN_ULID
npx cypress run --spec 'cypress/e2e/cart.cy.js'
npx cypress run --spec 'cypress/e2e/checkout.cy.js'
npx @probara/cli run close
```

## See also

- [Run options](runs.md): who closes a run, and when.
- [Debugging](debugging.md#check-what-would-be-sent): check the keys a spec would get, without
  sending anything.
