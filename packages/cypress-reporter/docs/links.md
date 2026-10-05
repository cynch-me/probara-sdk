# Links

A result can carry links: to a build, a story, a design, a dashboard. One helper adds them, and
another turns an issue id into a link with a template.

```js
// cypress/e2e/checkout.cy.js
it('pays by card', () => {
  probara.link('https://ci.example.com/build/12', 'Build 12');
  cy.get('.pay').click();
});
```

| Call                       | What it adds to the result                                         |
| -------------------------- | ------------------------------------------------------------------ |
| `probara.link(url, name?)` | A link with that URL, named by `name` (or by its URL)              |
| `probara.issue(id)`        | An issue, as a link built with `issueUrlTemplate`, named by the id |

Both need the support file and the plugin: they travel from the browser with one
`cy.task('probara', …)` each, like every other helper
([registration](configuration.md#registration)). A call outside a test is dropped with one warning
([metadata](metadata.md#what-is-different-in-a-cypress-run)).

`probara.link()` returns the helpers, so calls chain; `probara.issue()` takes the id of an issue in
your tracker (`PAY-7`, `SHOP-7`), not a URL.

## `probara.issue()` and `issueUrlTemplate`

An issue id becomes a URL with the template, and the link is named by the id:

```js
// cypress.config.js
module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: {
      projectId: 'SHOP',
      issueUrlTemplate: 'https://jira.example.com/browse/%s',
    },
    setupNodeEvents(on, config) {
      return probaraNodeEvents(on, config);
    },
  },
});
```

```js
// cypress/e2e/checkout.cy.js
it('pays by card', () => {
  probara.issue('PAY-7');
  cy.get('.pay').click();
});
```

```json
{
  "automationKey": "cypress/e2e/checkout.cy.js > pays by card",
  "links": [{ "url": "https://jira.example.com/browse/PAY-7", "name": "PAY-7" }]
}
```

The template is an `http` or `https` URL with `%s`, where the **URL-encoded** id goes
(`PROBARA_ISSUE_URL_TEMPLATE`). Without a template, the issues are left out and the run's log says
so, once:

```text
[probara] Dropped the issues of probara.issue(): no issueUrlTemplate turns their ids into links
```

A template that is not an http(s) URL with `%s` is a configuration problem that turns reporting off,
naming the option ([configuration](configuration.md#issueurltemplate)).

## What a link has to be

A URL has to be absolute and `http(s)`, of at most 2048 characters; anything else is refused where it
is called, and the test is never failed by a helper:

| What you see                                                              | Why                                                                   |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `probara.link() takes an absolute http(s) URL of at most 2048 characters` | `probara.link('not a url')`, or a URL too long. The link is not added |
| `probara.link() takes the name as a string`                               | The name was not a string; the link is not added                      |

A result holds 20 links, a name of at most 255 characters is cut, and links beyond the 20th are
dropped — each once per run, in the run's log:

```text
[probara] Dropped the links beyond the first 20 of a result
[probara] Truncated a link name longer than 255 characters
```

## Links of a case are not links of a result

A case's own links live in Probara, on the case; `probara.link()` adds a link to the **result** of
this run, next to its status and its steps. A link that belongs to every run is better set on the
case in Probara.

## See also

- [Metadata](metadata.md): the other helpers, and where they can be called.
- [Configuration](configuration.md#issueurltemplate): the template and its variable.
- [Troubleshooting](troubleshooting.md#the-helpers-did-nothing): every warning above, with what to
  do about each.
