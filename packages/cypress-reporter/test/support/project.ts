/**
 * The Cypress projects the end-to-end tests run, written into a throwaway workspace as a user's
 * project is laid out. They are data here, not files of the repository: a Cypress config and its
 * specs are CommonJS with `require` and `process`, which neither this repository's ESLint nor
 * Prettier can be told about for one package only (the other reporters' projects are ignored in
 * the root configurations, which are the orchestrator's to change).
 *
 * `PROJECT` registers the reporter and its plugin; `NO_PLUGIN` registers the reporter alone.
 */

/** The env vars a test drives the reporter's options with (`process.env` in `cypress.config.js`). */
export const VIDEOS = 'PROBARA_TEST_VIDEOS';
export const NO_BROWSER = 'PROBARA_TEST_NO_BROWSER';
export const UNKNOWN_OPTION = 'PROBARA_TEST_UNKNOWN_OPTION';
export const KEY_WITHOUT_FILE = 'PROBARA_TEST_KEY';
export const RETRIES = 'PROBARA_TEST_RETRIES';
export const STATUS = 'PROBARA_TEST_STATUS';
export const CAPTURE = 'PROBARA_TEST_CAPTURE';
export const SELECTION = 'PROBARA_TEST_SELECTION';
/** Registers `cypress-junit` instead of the reporter: the import path of the key parity. */
export const JUNIT_REPORTER = 'PROBARA_TEST_JUNIT';

/** The reporter options the project's config builds from the environment. */
const OPTIONS = `/** The reporter options a test asks for, through the environment it runs Cypress in. */
function reporterOptions() {
  return {
    projectId: 'SHOP',
    run: { name: 'Cypress run' },
    ...(process.env.${VIDEOS} === '1' ? { attachVideos: true } : {}),
    ...(process.env.${NO_BROWSER} === '1' ? { browserAsParameter: false } : {}),
    ...(process.env.${UNKNOWN_OPTION} === '1' ? { notAnOption: true } : {}),
    ...(process.env.${KEY_WITHOUT_FILE} === 'no-file' ? { keyIncludesFile: false } : {}),
    ...(process.env.${STATUS} === 'map' ? { statusMapping: { failed: 'blocked' } } : {}),
    ...(process.env.${STATUS} === 'filter' ? { statusFilter: ['failed'] } : {}),
    ...(process.env.${CAPTURE} === '1' ? { captureOutput: true } : {}),
    ...(process.env.${SELECTION} === '1' ? { runCasesOnly: true } : {}),
  };
}`;

/** The project with the reporter and its plugin: every spec of the run goes through both. */
export const PROJECT: Readonly<Record<string, string>> = {
  'package.json': `{ "name": "cypress-project", "private": true, "version": "0.0.0" }\n`,
  'cypress.config.js': `const { defineConfig } = require('cypress');
const { probaraNodeEvents } = require('@probara/cypress-reporter/setup');

${OPTIONS}

module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: reporterOptions(),
    video: process.env.${VIDEOS} === '1',
    screenshotOnRunFailure: true,
    retries: { runMode: Number(process.env.${RETRIES} ?? 1) },
    setupNodeEvents(on, config) {
      return probaraNodeEvents(on, config);
    },
  },
});
`,
  'cypress/support/e2e.js': `// The support file of a project that reports to Probara: one line turns the
// \`probara.*\` helpers of the browser on (\`import\` works as well as \`require\`).
import '@probara/cypress-reporter/support';
`,
  'cypress/e2e/cart.cy.js': `describe('Cart', () => {
  it('adds an item', () => {
    cy.wrap(1).should('equal', 1);
  });

  it('SHOP-12 fails on purpose', () => {
    expect('boom').to.equal('bang');
  });

  it.skip('is skipped', () => {});
});

describe('SHOP-7 Checkout', () => {
  it('WEB-3 keeps another project id in its title', () => {
    cy.wrap(2).should('equal', 2);
  });

  it('pays by card', () => {
    cy.wrap(3).should('equal', 3);
  });
});
`,
  'cypress/e2e/retry.cy.js': `let attempts = 0;

describe('Flaky', () => {
  beforeEach(() => {
    attempts += 1;
  });

  it('passes on its retry', () => {
    if (attempts < 2) throw new Error('attempt ' + attempts + ' failed');
  });

  it('passes first time', () => {
    cy.wrap(1).should('equal', 1);
  });
});
`,
  'cypress/e2e/hooks.cy.js': `let attempt = 0;

describe('Cart', () => {
  beforeEach(() => {
    attempt += 1;
    if (attempt === 1) throw new Error('the hook fails on the first attempt');
  });

  it('passes on the retry of its hook', () => {
    cy.wrap(1).should('equal', 1);
  });
});

describe('Checkout', () => {
  beforeEach(() => {
    throw new Error('this hook always fails');
  });

  it('never runs', () => {});
  it('never runs either', () => {});
});

describe('Profile', () => {
  it('still runs', () => {
    cy.wrap(1).should('equal', 1);
  });
});
`,
  'cypress/e2e/throws.cy.js': `// A spec whose body throws while Cypress loads it: it builds no reporter, either.
throw new Error('this spec cannot even load');

describe('Never', () => {
  it('never runs', () => {});
});
`,
  'cypress/e2e/login.cy.js': `describe('Login', () => {
  it('is only reported when it is asked for', () => {
    cy.wrap(1).should('equal', 1);
  });
});
`,
};

/**
 * A spec Cypress cannot parse: it builds no reporter at all, and its `after:spec` reports one
 * failure with no test. A file that does not parse is never one of the repository's own, which is
 * why it is written into a workspace.
 */
export const BROKEN_SPEC = `describe('Broken', () => {
  it('never runs', () => {
    this is not javascript
  });
});
`;

/** The same project without the plugin: the reporter alone, which must still report everything. */
export const NO_PLUGIN: Readonly<Record<string, string>> = {
  'cypress.config.js': `const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: { projectId: 'SHOP' },
    screenshotOnRunFailure: false,
    retries: { runMode: 0 },
  },
});
`,
};

/** A file the specs attach by path: read from the project root, as Cypress reads it. */
export const CART_CSV = 'sku,qty\nA-1,2\nB-7,1\n';

/**
 * The project the key parity runs over: the same suite, run twice. With the reporter registered it
 * reports to Probara (the first path); with `PROBARA_TEST_JUNIT=1` it is `cypress-junit` with the
 * options its own documentation gives (`[hash]`, so every spec keeps its own file, and
 * `includePending`, without which a skipped test never reaches the XML), and no plugin (the second
 * path, whose results `probara import junit` reads).
 *
 * The suite holds every shape the two paths can disagree on: describes two and three levels deep,
 * an `it.skip`, a failure with a stack and a test that throws, a hook that fails once and a hook
 * that fails always, a case id in a describe title and another in an `it` title, a title holding
 * the ` -- ` Cypress joins its screenshot names with, a unicode title, and a second spec whose
 * tests live in the root suite. `retries.runMode: 1` on both paths, so the difference between one
 * result per attempt and one result per test is real.
 */
export const PARITY: Readonly<Record<string, string>> = {
  'package.json': `{ "name": "cypress-parity", "private": true, "version": "0.0.0" }\n`,
  'cypress.config.js': `const { defineConfig } = require('cypress');
const { probaraNodeEvents } = require('@probara/cypress-reporter/setup');

// The import path: cypress-junit with the options its documentation gives, and no plugin.
const junit = process.env.${JUNIT_REPORTER} === '1';

module.exports = defineConfig({
  e2e: {
    // Neither path needs the browser helpers of the support file: the specs assert, and nothing
    // else. \`supportFile: false\` is what a project without one says.
    supportFile: false,
    reporter: junit ? 'cypress-junit' : '@probara/cypress-reporter',
    reporterOptions: junit
      ? { mochaFile: 'junit-[hash].xml', includePending: true }
      : { projectId: 'PRB' },
    video: false,
    // The keys are what this suite is about; the screenshots of a failed attempt are proven with
    // their own runs in \`test/cypress-run.test.ts\`.
    screenshotOnRunFailure: false,
    // The same on both paths: a test that fails once and then passes is what makes the difference
    // between one result per attempt and one result per test a real one.
    retries: { runMode: 1 },
    ...(junit
      ? {}
      : {
          setupNodeEvents(on, config) {
            return probaraNodeEvents(on, config);
          },
        }),
  },
});
`,
  'cypress/e2e/parity-suite.cy.js': `// A case id in the title of a describe: every test of it links to the case, and no key
// of them holds the id.
describe('PRB-12 Cart', () => {
  it('adds an item', () => {
    cy.wrap(1).should('equal', 1);
  });

  // Two levels deep.
  describe('Checkout', () => {
    it('pays by card', () => {
      cy.wrap(2).should('equal', 2);
    });

    // A skipped test, which only reaches the JUnit with \`includePending\`.
    it.skip('pays with a voucher', () => {});
  });

  // Three levels deep.
  describe('Refunds', () => {
    describe('Partial', () => {
      it('refunds one item', () => {
        cy.wrap(3).should('equal', 3);
      });
    });
  });
});

describe('Reports', () => {
  // The separator Cypress joins the suite titles and the test title of a screenshot name with:
  // nothing in a key, a title or a status may be confused by it.
  it('keeps a -- in its title and fails', () => {
    expect('boom').to.equal('bang');
  });

  it('accepts café and ñandú', () => {
    cy.wrap('ñandú').should('equal', 'ñandú');
  });
});

// A case id in the title of a test, in a describe of its own.
describe('Invoice', () => {
  it('PRB-12 is paid by invoice', () => {
    cy.wrap(4).should('equal', 4);
  });
});

describe('Failures', () => {
  it('fails on purpose', () => {
    expect('boom').to.equal('bang');
  });

  it('throws on purpose', () => {
    throw new TypeError('the test threw');
  });
});

// A hook that fails on its first attempt: the reporter reports the failed attempt and the pass
// under one key, and cypress-junit writes the pass alone.
describe('Flaky', () => {
  let attempt = 0;

  beforeEach(() => {
    attempt += 1;
    if (attempt === 1) throw new Error('the hook fails once');
  });

  it('passes on the retry of its hook', () => {
    cy.wrap(5).should('equal', 5);
  });
});

// A hook that fails on every attempt: Cypress names the failure after the hook and the test it was
// running, and the tests after it never run. The reporter reports that one failure and the tests
// that never ran as skipped; cypress-junit writes the failure alone.
describe('Always', () => {
  beforeEach(() => {
    throw new Error('this hook always fails');
  });

  it('never runs', () => {});
  it('never runs either', () => {});
});
`,
  'cypress/e2e/parity-root.cy.js': `// The tests of this spec live in the root suite: cypress-junit calls that suite
// \`Root Suite\`, gives it the \`file\` attribute of the spec, and writes a top-level test's name
// once, with no describe in between.
it('runs in the root suite', () => {
  cy.wrap(6).should('equal', 6);
});

it('fails in the root suite', () => {
  expect(1).to.equal(2);
});
`,
};

/**
 * The specs of the browser helpers, in a project of their own: everything the support file says a
 * test can tell the reporter, with the failures a step's failure and an unfinished step produce.
 */
export const HELPERS: Readonly<Record<string, string>> = {
  'cypress/e2e/helpers.cy.js': `describe('Helpers', () => {
  before(() => {
    // A suite-level \`before\` runs with no test running: the reporter drops what it says, with one
    // warning, and never gives it to another test.
    probara.title('Never attributed to any test');
  });

  it('says everything a helper can', () => {
    probara
      .id('SHOP-12')
      .title('Adds an item')
      .suite(['Cart', 'Checkout'])
      .comment('from the cart')
      .parameters({ build: 42, ok: true })
      .tags('smoke', 'cart')
      .fields({ severity: 'high' })
      .link('https://ci.example.com/build/12', 'Build')
      .issue('PRB-7');
    cy.wrap(1).should('equal', 1);
  });

  it('takes a wrong argument without failing', () => {
    probara.link('not a url');
    cy.wrap(1).should('equal', 1);
  });

  it('attaches a body, a file, and a file inside a step', () => {
    probara.attach({ name: 'note.txt', body: 'a note' });
    probara.attach({ name: 'cart.csv', path: 'fixtures/cart.csv' });
    probara.step('Adds an item', () => {
      probara.attach({ name: 'inside.txt', body: 'inside the step' });
    });
    cy.wrap(1).should('equal', 1);
  });

  it('runs nested steps', () => {
    probara.step(
      'Adds an item',
      () => {
        cy.wrap('a').should('equal', 'a');
        probara.step('Finds the cart', () => {
          cy.wrap('b').should('equal', 'b');
        });
      },
      { expected: 'The cart holds one item', data: '{"sku":"A-1"}' },
    );
  });

  it('ends a step that throws as failed, and the test fails too', () => {
    probara.step('Fails on purpose', () => {
      throw new Error('the step failed');
    });
  });

  it('leaves a step unfinished when its command fails', () => {
    probara.step('Fails on purpose too', () => {
      cy.wrap('a').should('equal', 'b');
    });
  });

  it('writes to the console', () => {
    console.log('a line of stdout');
    console.warn('a line of stderr');
    cy.wrap(1).should('equal', 1);
  });

  after(() => {
    // A suite's \`after\` runs once every test of it ended. Cypress still names the last one as the
    // running test, so only the reporter's own rules keep this message out of its result.
    probara.title('Said after the last test ended');
  });
});

describe('Hooks', () => {
  beforeEach(() => {
    probara.comment('from the beforeEach');
  });

  afterEach(() => {
    probara.comment('from the afterEach');
  });

  it('takes what its own hooks said', () => {
    probara.comment('from the test');
    cy.wrap(1).should('equal', 1);
  });
});
`,
};

/** The paths of the files of `project`, from the workspace's directory. */
export function projectFiles(project: Readonly<Record<string, string>>): string[] {
  return Object.keys(project);
}
