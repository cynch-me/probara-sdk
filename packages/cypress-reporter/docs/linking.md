# Linking tests to cases

A Cypress test is matched to its Probara case by an **automation key**, and the key is built out of
two things Cypress already tells the reporter: the spec path and the test's full title. Nothing else
enters it — not the browser, not the attempt, not a parameter, not the CI build.

## Case ids in titles

A case id in a title links the test to that case. There is nothing to import and no helper to call:

```js
// cypress/e2e/cart.cy.js
describe('Cart', () => {
  it('SHOP-12 adds an item', () => {
    cy.get('.add').click();
  });
});
```

```text
cypress/e2e/cart.cy.js > Cart adds an item     → the case SHOP-12
```

- A case id in a **`describe`** links every test of it.
- A case id in an **`it`** links that test.
- **Several ids** in either link the test to several cases, and the test is recorded once per case.
- The id is **not** part of the key, so renaming the title keeps the case.

The id is `<PROJECT>-<number>`, and only the codes of `projectId` and `projects` are read
([projects](projects.md#several-probara-projects)):

```text
cypress/e2e/cart.cy.js > Checkout WEB-3 keeps another project id in its title
```

`WEB-3` is not a case of a project this run reports to, so it stays in the title and in the key like
any other word, and the test goes to `projectId`.

## `probara.id()`

The helper links the test without touching its title:

```js
it('adds an item', () => {
  probara.id('SHOP-12');
  cy.get('.add').click();
});
```

Same result, same case, and it works in a `beforeEach` for every test of the block. Two things to
know:

- It is sent **with the test**, so it cannot decide which tests run under
  [`runCasesOnly`](run-selection.md#what-a-test-must-match): a test selected by key or title, not by
  a `probara.id()` call.
- The helpers need the support file and the plugin; without them the call does nothing
  ([registration](configuration.md#registration)).

## Automation keys

```text
<spec path, relative to the project root> > <the full title of the test>
```

The **full title** is what Mocha calls `test.fullTitle()`: the `describe` titles and the `it` title
joined by **single spaces**, as one segment. The spec path is Cypress's `projectRoot` relative, with
`/` separators, and it is part of the key because `keyIncludesFile` is on by default.

```js
// cypress/e2e/parity-suite.cy.js
describe('PRB-12 Cart', () => {
  describe('Checkout', () => {
    it('pays by card', () => {
      cy.get('.pay').click();
    });
  });
});
```

```text
cypress/e2e/parity-suite.cy.js > Cart Checkout pays by card
```

That is the key `probara import junit` gives the same test on the JUnit of Cypress's `junit`
reporter or of [cypress-junit](https://www.npmjs.com/package/cypress-junit), which is what makes the
switch from the import lossless ([migrating from the JUnit import](migrating-from-junit.md));
`test/parity.test.ts` proves it by running one suite both ways, with Cypress's `junit` reporter.

### What changes a key

| What                                          | Why                                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Renaming a spec, a `describe` or an `it`      | The spec path and the titles are the key                                                        |
| Moving a spec                                 | Its path is the key                                                                             |
| Starting `cypress run` from another directory | The path is relative to Cypress's `projectRoot`, which is the directory `cypress run` runs from |
| Changing `keyIncludesFile`                    | It decides whether the spec path is in the key at all                                           |
| A new Cypress version, or a rewritten suite   | Nothing, unless a path or a title changed                                                       |

### What never changes a key

- **Retries**: a retried test sends several results of one case ([retries](retries.md)).
- **The browser**: it is a `browser` parameter of every result ([projects](projects.md#what-the-browser-and-the-case-suite-do-not-change)).
- **Parameters, tags, fields, comments and steps**: they are metadata of the result and of the case
  ([metadata](metadata.md)).
- **The shard, the CI build, `--spec`, `excludeSpecPattern`**: no CI variable and no command-line
  flag reaches a key.
- **`rootDir` set to another directory**: it changes what the paths are _relative to_, which does
  change the key — that is the point of setting it when Cypress runs from somewhere else.

## Key traps in Cypress

- **Two tests with the same full title are one case.** Mocha allows `it('adds an item')` twice in
  one `describe`, and then both tests record into one case. The same happens for `a b` › `c` next to
  `a` › `b c`: the full title is `a b c` for both, and the import would see one test as well. Give
  every test its own title.
- **`it.only` leaves out what it does not run.** Cypress removes the other tests from its own tree,
  so they are not reported at all — not as skipped, not as anything
  ([specs](specs.md#itonly)).
- **A hook's failure is a test of its own**, named `"before each" hook for "…"` by Cypress and by
  the import ([specs](specs.md#a-hook-that-fails)). Its key is the one a JUnit report holds.
- **A spec Cypress cannot parse** is one result named `Spec failed to run` ([specs](specs.md#a-spec-cypress-cannot-run)).

## `keyIncludesFile`

`keyIncludesFile: false` (`PROBARA_KEY_INCLUDES_FILE`) leaves the spec path out of the key, like a
JUnit report written without the `file` attribute of its root suite:

```text
Cart Checkout pays by card
```

Switch to it when your cases were imported from such reports, so each test keeps its case; keep it
on otherwise, since two specs with the same describes and titles are then one case
([configuration](configuration.md#keyincludesfile)).

## See also

- [Migrating from the JUnit import](migrating-from-junit.md): the key contract, proven both ways.
- [Metadata](metadata.md): `probara.id()` and what else a test can say about itself.
- [Projects](projects.md): which case ids are read out of titles.
