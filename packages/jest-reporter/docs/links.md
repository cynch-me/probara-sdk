# Links

A result can carry links, shown with it in Probara: the build that ran it, the page it tested, the
issues of your tracker it is about. `probara.link()` adds a link; `probara.issue()` names an issue,
which `issueUrlTemplate` turns into a link.

## `probara.link()`

`probara.link(url, name?)` takes an absolute `http` or `https` URL and an optional name, shown
instead of the URL:

<!-- project: link -->

```js
// tests/search.test.js
const { probara } = require('@probara/jest-reporter');

test('searches the catalog', () => {
  probara
    .link('https://shop.example.com/search?q=boots', 'Search page')
    .link('https://ci.example.com/builds/1042');
});
```

<!-- sent: link -->

```json
[
  {
    "automationKey": "tests/search.test.js > searches the catalog",
    "links": [
      { "url": "https://shop.example.com/search?q=boots", "name": "Search page" },
      { "url": "https://ci.example.com/builds/1042" }
    ]
  }
]
```

## `probara.issue()` and `issueUrlTemplate`

`probara.issue(id)` names an issue of your tracker by its id. With `issueUrlTemplate`
(`PROBARA_ISSUE_URL_TEMPLATE`), a URL with `%s` where the id goes, it becomes a link of the result,
named by the id:

<!-- project: issue -->

```js
reporters: [
  'default',
  ['@probara/jest-reporter', { issueUrlTemplate: 'https://jira.example.com/browse/%s' }],
],
```

<!-- project: issue -->

```js
// tests/checkout.test.js
const { probara } = require('@probara/jest-reporter');

test('rounds the total', () => {
  probara.issue('PAY-7').issue('PAY 12');
});
```

<!-- sent: issue -->

```json
[
  {
    "automationKey": "tests/checkout.test.js > rounds the total",
    "links": [
      { "url": "https://jira.example.com/browse/PAY-7", "name": "PAY-7" },
      { "url": "https://jira.example.com/browse/PAY%2012", "name": "PAY 12" }
    ]
  }
]
```

- The id goes into the template URL-encoded (`PAY 12` becomes `PAY%2012`), in place of the first
  `%s`.
- The template is an `http` or `https` URL with `%s`; any other value turns reporting off with an
  error that names `issueUrlTemplate`.
- Without a template, the issues are left out, and one warning says so: the result is recorded
  without them.

<!-- project: no-template -->

```js
// tests/checkout.test.js
const { probara } = require('@probara/jest-reporter');

test('rounds the total', () => {
  probara.issue('PAY-7');
});
```

<!-- output: no-template -->

```text
$ npx jest
[probara] Dropped the issues of probara.issue(): no issueUrlTemplate turns their ids into links (first seen in "rounds the total"; repeats are logged at debug)
[probara] Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 1 result (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

## Rules

| Rule                                             | What happens                                     |
| ------------------------------------------------ | ------------------------------------------------ |
| Links and issues of one attempt                  | Sent in call order, links and issues together    |
| A URL that is not an absolute `http`/`https` URL | Left out, with a warning                         |
| A URL over 2048 characters                       | Left out, with a warning                         |
| A name over 255 characters                       | Cut to 255 characters, with a warning            |
| More than 20 links in a result                   | The first 20 are sent, with a warning            |
| A retry                                          | Starts without links: each attempt sends its own |

Links belong to the result, not to the case: an existing case never changes, and each result keeps
the links its attempt added.

## See also

- [Metadata](metadata.md): the other helpers.
- [Configuration](configuration.md#issueurltemplate): `issueUrlTemplate`.
- [Coming from other tools](coming-from-other-tools.md): Allure's `link()`, `issue()` and templates.
