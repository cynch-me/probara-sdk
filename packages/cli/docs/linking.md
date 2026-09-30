# Linking tests to cases

Every result lands on a Probara test case. A test that names its case links to that case; any
other test is matched by its automation key, and a case is created the first time a key is seen.

## Quick path

- Do nothing: the first import creates one case per test, and every later import of the same test
  lands on the same case, because its automation key stays the same.
- To link a test to a case that already exists, put the case id in the test name (`SHOP-12 adds an
item`) or in a `probara_case` property.
- To never create cases, pass `--no-create-missing-cases`.

## How a result finds its case

| The testcase has                                    | Probara matches it by                                |
| --------------------------------------------------- | ---------------------------------------------------- |
| a `probara_case` property, or a case id in its name | The case id. It is authoritative.                    |
| neither                                             | The automation key. An unknown key creates the case. |

With a case id, the automation key is still sent. A case that has no key yet takes the test's key,
so the test keeps landing on it even after the id is removed (as long as no other case holds that
key).

## Case ids in test names

A case id is the project code, `-` or `_`, and the case number: `SHOP-12` or `SHOP_12`. The CLI
looks for the ids of the configured project only (`--project` or `PROBARA_PROJECT`), matching the
code's case exactly. Without a project, as in a dry run without one, names are not scanned.

An id counts when it stands on its own: in `[]` or `()`, after `@`, or with no letter or digit
right before or after it. `_` does not glue it to a word, so `test_SHOP_12_totals` holds `SHOP_12`.
Python and Java names cannot hold `-`, which is why `_` is accepted.

The ids are taken out of the title and of the automation key, with the separator they leave
behind, and so is a bracket they leave empty or holding only separators (`(@SHOP-17)`,
`[SHOP-18, SHOP-19]`), so adding or removing an id never changes the key. A bracket that holds
other text stays (`(see SHOP-12)` becomes `(see)`). Here is a report, then what
`probara import junit example.xml --dry-run` prints for it with `PROBARA_PROJECT=SHOP`: the status,
the linked case (`-` for none) and the automation key of each result.

```xml
<testsuites>
  <testsuite name="checkout">
    <testcase classname="checkout.CartTest" name="SHOP-12 adds an item" time="0.25"/>
    <testcase classname="checkout.CartTest" name="removes an item [SHOP-13]" time="0.1"/>
    <testcase classname="checkout.CartTest" name="applies a coupon (SHOP-14)" time="0.1"/>
    <testcase classname="checkout.CartTest" name="empties the cart @SHOP-15" time="0.1"/>
    <testcase classname="checkout.CartTest" name="test_SHOP_16_totals" time="0.1"/>
    <testcase classname="checkout.CartTest" name="pays with a gift card (@SHOP-17)" time="0.1"/>
    <testcase classname="checkout.CartTest" name="keeps XSHOP-1, SHOP-1a and shop-2 in the name" time="0.1"/>
  </testsuite>
</testsuites>
```

<!-- dry-run -->

```text
passed	SHOP-12	checkout.CartTest > adds an item
passed	SHOP-13	checkout.CartTest > removes an item
passed	SHOP-14	checkout.CartTest > applies a coupon
passed	SHOP-15	checkout.CartTest > empties the cart
passed	SHOP-16	checkout.CartTest > test_totals
passed	SHOP-17	checkout.CartTest > pays with a gift card
passed	-	checkout.CartTest > keeps XSHOP-1, SHOP-1a and shop-2 in the name
Total: 7 results from 1 file (7 passed, 0 failed, 0 skipped, 0 blocked)
```

`XSHOP-1` is glued to a letter, `SHOP-1a` too, and `shop-2` is not the project's code: all three
stay in the name.

## The `probara_case` property

A `<property name="probara_case" value="SHOP-20"/>` on the testcase links it like an id in the
name, whatever the name says. The value is a comma-separated list. The property is taken as is,
for any project code: an id of a project that is neither the project nor one of `--projects` is not
sent ([cases of several projects](#cases-of-several-projects)).

## One test, several cases

A test with several ids (in its name, its property, or both) fans out: it sends one result per
case, each with the same status, duration, notes and attachments. The same id twice counts once.

```xml
<testsuites>
  <testsuite name="checkout">
    <testcase classname="checkout.CartTest" name="checks out as a guest" time="1.5">
      <properties>
        <property name="probara_case" value="SHOP-20, SHOP-21"/>
      </properties>
    </testcase>
    <testcase classname="checkout.CartTest" name="SHOP-22 SHOP-23 pays by card" time="0.8">
      <failure message="card declined"/>
    </testcase>
  </testsuite>
</testsuites>
```

<!-- dry-run -->

```text
passed	SHOP-20	checkout.CartTest > checks out as a guest
passed	SHOP-21	checkout.CartTest > checks out as a guest
failed	SHOP-22	checkout.CartTest > pays by card
failed	SHOP-23	checkout.CartTest > pays by card
Total: 4 results from 1 file (2 passed, 2 failed, 0 skipped, 0 blocked)
```

## Cases of several projects

A result goes to the project of its case: `WEB-3` belongs to `WEB`. Only the project
(`--project`) is used by default, and a result linked to a case of any other project is **not
sent**, with one warning per project (it would land in the wrong project, where Probara refuses
the id); `summary.dropped` counts them. List the other projects in `--projects` (or
`PROBARA_PROJECTS=WEB,API`):

- A case of a listed project goes into a run of that project, created with the same name and tags
  and closed after the import; a test linked to cases of several projects is sent once per case,
  each to its project.
- Ids of the listed projects in test names link too, and leave the automation key.
- A test without a case goes to the project (automation keys belong to one project): only the
  project creates cases, under `--suite-ulid`.
- `--run-description`, `--environment`, `--milestone`, `--plan` and `--configuration-value` go
  with every new run: names resolve in each project, so each project needs its own milestone,
  plan or configuration of that name.
- `--environment-id`, `--milestone-id` and `--configuration` belong to one project: they only
  apply to the project's run. To set them in another project, create its run first
  (`probara run create --project WEB ...`) and pass it in `--run-ulids WEB=<ulid>` (or
  `PROBARA_RUN_ULIDS`); the project's own run can go there too (`SHOP=<ulid>`), like `--run-ulid`.
  Existing runs stay open unless `--close-run` is given.
- A failed report stops only its project; the import exits 1.

```xml
<testsuites>
  <testsuite name="checkout">
    <testcase classname="checkout.CartTest" name="SHOP-20 WEB-3 checks out as a guest" time="1.5"/>
    <testcase classname="checkout.CartTest" name="pays by card" time="0.8">
      <properties>
        <property name="probara_case" value="API-7"/>
      </properties>
    </testcase>
  </testsuite>
</testsuites>
```

<!-- dry-run: --projects WEB -->

```text
passed	SHOP-20	checkout.CartTest > checks out as a guest
passed	WEB-3	checkout.CartTest > checks out as a guest
passed	API-7	checkout.CartTest > pays by card	dropped: API is not listed in --projects, not sent
Total: 3 results from 1 file (3 passed, 0 failed, 0 skipped, 0 blocked); 1 dropped (a project not listed), not sent
```

## Adding a case id in each framework

| Framework      | How                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| pytest         | `record_property("probara_case", "SHOP-12")` in the test, or `def test_SHOP_12_adds_an_item()`                 |
| Playwright     | An annotation `{ type: 'probara_case', description: 'SHOP-12' }`, or the id in the title                       |
| Jest           | The id in the test or describe title: `test('SHOP-12 adds an item', ...)`                                      |
| Go (gotestsum) | The id in a subtest name: `t.Run("SHOP-12 adds an item", ...)` (Go writes `SHOP-12_adds_an_item`, still an id) |
| Maven Surefire | `void SHOP_12_addsAnItem()`, or `@DisplayName("SHOP-12 adds an item")` with the phrased reporter               |
| Any other tool | The id in the testcase name, or a `probara_case` property if the tool writes testcase properties               |

pytest:

```python
def test_adds_an_item(record_property):
    record_property("probara_case", "SHOP-12")
    ...
```

Playwright writes each annotation as a testcase property:

```js
test('adds an item', { annotation: { type: 'probara_case', description: 'SHOP-12' } }, async () => {
  // ...
});
```

Jest (jest-junit), Go and Surefire do not write testcase properties the CLI could read: jest-junit
writes none by default, `go test` has no properties at all, and JUnit 5's
`TestReporter.publishEntry` does not reach Surefire's XML. Use the name. For Surefire display names,
see [the phrased reporter](junit.md#maven-surefire).

## The automation key

A test with no case id is matched by its automation key: the file (when the dialect has one), the
title path and the parameters, joined with `>`, such as
`login.spec.js > login > logs in with a valid password [project=node]`. The algorithm is
[automation key v1](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#the-automation-key-v1), shared by every Probara tool and
frozen: changing it would unlink every case already reported. [JUnit mapping](junit.md) shows the
key each dialect builds, with real examples.

### What keeps a key, and what changes it

The same test gives the same key on every import, on any machine, as long as the report says the
same thing about it:

| Does not change the key                         | Changes the key (a new case is created)                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Adding or removing a case id in the name        | Renaming the test, a describe block, a class or a package                                  |
| The status, duration, output or time of the run | Moving a test file, when the dialect keys on the file (Jest with `file`, Playwright)       |
| Importing the same file again, into any run     | Renaming a Playwright project (it is the `project=` parameter)                             |
| The order of the files on the command line      | Turning on jest-junit's file attribute, Surefire's phrased names, or gotestsum short names |
|                                                 | A different `--root-dir`, or `--dialect` instead of the detected dialect                   |

To keep the history of a test you rename, put its case id in the new name (or in a
`probara_case` property) before you import: the result lands on the old case by id.
[Troubleshooting](troubleshooting.md#a-renamed-test-created-a-duplicate-case) covers cleaning up a
duplicate.

## Turning case creation off

`--no-create-missing-cases` (or `PROBARA_CREATE_MISSING_CASES=false`) only records results of
tests that match a case. The others are reported as unmatched, with the reason `case_not_found`,
and the command still exits 0:

<!-- output: import -->

```text
$ probara import junit junit.xml --no-create-missing-cases
[probara] junit.xml: jest, 10 results
[probara] Results: 10 (7 passed, 2 failed, 1 skipped, 0 blocked)
[probara] Project: SHOP
[probara] Run: new run "Automated run 2026-09-29 14:05 UTC"
[probara] Base URL: https://app.probara.net
[probara] Missing cases: not created
[probara] Attachments: on
[probara] Recorded 0 results (0 new cases, 10 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] 10 results were not recorded (case_not_found): login PRB-12 logs in with a valid password; login rejects a wrong password; login crashes on an unexpected exception; login supports SSO (skipped: SSO provider not configured); login session refresh renews the token before expiry; login username alice has length 5; login username bob has length 3; login prints to stdout and stderr; login accepts café and ñandú; [PRB-13] top-level test outside any describe
```

Use it when the cases are written first (spec-first) and a test must never add one. Created cases
go under the project root, or under the suite of `--suite-ulid`, nested by the result's suite path.

## Unmatched results

An unmatched result records nothing. The log names the reason and a few examples, and `--json`
lists each one in `summary.unmatched`. Unmatched results do not change the exit code.

| Reason               | Why                                                                                   | Fix                                               |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `case_not_found`     | No case has that id; or no case has the key and case creation is off                  | Check the id, or allow case creation              |
| `invalid_display_id` | The id is not an id of this project, such as another project's code in `probara_case` | Use an id of the project you report into          |
| `case_archived`      | The case with that id or key is archived                                              | Restore the case, or remove the id from the test  |
| `title_required`     | A new case needs a title                                                              | Not expected from the CLI, which always sends one |

## See also

- [JUnit mapping and dialects](junit.md): the title path and key of each framework.
- [Troubleshooting](troubleshooting.md#results-come-back-unmatched).
- [Configuration](configuration.md): `--project`, `--suite-ulid`, `--root-dir`.
