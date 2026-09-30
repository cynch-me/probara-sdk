// The `page` of the docs examples: CI has no browser, so the docs tests give every test a stand-in
// whose methods resolve (`goto`, `getByRole(...).click()`, `fill`...) and whose `screenshot()`
// returns a PNG. It stands for what the examples do with a page; what they report is real.
'use strict';

// A 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** A value that is callable, has every property, and resolves to undefined when awaited. */
function chain() {
  return new Proxy(function standIn() {}, {
    get(_target, property) {
      if (property === 'then') return (resolve) => resolve(undefined);
      return chain();
    },
    apply() {
      return chain();
    },
  });
}

function standInPage() {
  return new Proxy(
    {},
    {
      get(_target, property) {
        // Not a promise itself: fixtures hand it over as it is.
        if (property === 'then') return undefined;
        if (property === 'screenshot') return async () => PNG;
        return chain();
      },
    },
  );
}

module.exports = { standInPage };
