/** What each JUnit writer means by its attributes: detection and identity per dialect. */
import type { JUnitDocument, JUnitOutcome, JUnitSuite, JUnitTestCase } from './model.js';

export const JUNIT_DIALECTS = [
  'jest',
  'pytest',
  'playwright',
  'surefire',
  'gotestsum',
  'generic',
] as const;

export type JUnitDialect = (typeof JUNIT_DIALECTS)[number];

/** How one testcase is identified, before case ids are taken out of its name. */
export interface IdentityParts {
  file?: string;
  /** Title segments before the name (a class, a package). Never scanned for case ids. */
  context: string[];
  /** Title segments that come from the test name. Case ids are found and removed here. */
  name: string[];
  parameters?: Record<string, string>;
  suitePath?: string[];
}

export interface DialectMapping {
  /** The testcases that are tests of their own, in document order. */
  testcases(suite: JUnitSuite): JUnitTestCase[];
  identity(testcase: JUnitTestCase & { name: string }, suite: JUnitSuite): IdentityParts;
  startedAt(suite: JUnitSuite): string | undefined;
  error(outcome: JUnitOutcome): { message?: string; stack?: string } | undefined;
  skipReason(testcase: JUnitTestCase, outcome: JUnitOutcome): string | undefined;
}

const PLAYWRIGHT_SEPARATOR = ' › ';
const UTC_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function hasProperty(suite: JUnitSuite, name: string): boolean {
  return suite.properties.some((property) => property.name === name);
}

/** Which tool wrote the report, from the marks each one leaves. */
export function detectDialect(document: JUnitDocument): JUnitDialect {
  const { suites, attributes } = document;
  if (suites.some((suite) => hasProperty(suite, 'go.version'))) return 'gotestsum';
  if (attributes.name === 'pytest tests' || suites.some((suite) => suite.name === 'pytest')) {
    return 'pytest';
  }
  if (attributes.name === 'jest tests') return 'jest';
  if (
    document.root === 'testsuite' &&
    (Object.values(attributes).some((value) => value.includes('surefire')) ||
      suites.some((suite) => suite.properties.some(({ name }) => name.startsWith('surefire.'))))
  ) {
    return 'surefire';
  }
  const testcases = suites.flatMap((suite) =>
    suite.testcases.map((testcase) => ({ suite, testcase })),
  );
  if (
    testcases.length > 0 &&
    testcases.every(({ suite, testcase }) => testcase.classname === suite.name) &&
    ('id' in attributes ||
      testcases.some(({ testcase }) => testcase.name?.includes(PLAYWRIGHT_SEPARATOR) === true))
  ) {
    return 'playwright';
  }
  return 'generic';
}

function nonBlank(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** What may follow a classname the name repeats: `Cart adds`, `Cart.adds`, `Cart::adds`, … */
const CLASSNAME_SEPARATORS = [' ', '.', '::', '/', '#'];

/** Whether `name` is `classname`, or starts with it followed by a separator (` › ` included). */
function repeatsClassname(name: string, classname: string): boolean {
  if (name === classname) return true;
  if (!name.startsWith(classname)) return false;
  const rest = name.slice(classname.length);
  return CLASSNAME_SEPARATORS.some((separator) => rest.startsWith(separator));
}

/**
 * `[classname, name]`, without a classname that is empty or that the name already repeats (`Cart`
 * for `Cart adds`, never for `CartTest adds`, so the two keep their own keys).
 */
function classAndName(
  testcase: JUnitTestCase & { name: string },
): Pick<IdentityParts, 'context' | 'name'> {
  const classname = testcase.classname?.trim() ?? '';
  const skipClass = classname === '' || repeatsClassname(testcase.name, classname);
  return { context: skipClass ? [] : [classname], name: [testcase.name] };
}

function errorOf(outcome: JUnitOutcome): { message?: string; stack?: string } | undefined {
  const message = nonBlank(outcome.message);
  const stack = outcome.body ?? outcome.stackTrace;
  if (message === undefined && stack === undefined) return undefined;
  return {
    ...(message === undefined ? {} : { message }),
    ...(stack === undefined ? {} : { stack }),
  };
}

const base: DialectMapping = {
  testcases: (suite) => suite.testcases,
  identity(testcase) {
    const parts = classAndName(testcase);
    const classname = parts.context[0];
    return { ...parts, ...(classname === undefined ? {} : { suitePath: [classname] }) };
  },
  startedAt: (suite) => nonBlank(suite.timestamp),
  error: errorOf,
  skipReason: (_testcase, outcome) => nonBlank(outcome.message),
};

const jest: DialectMapping = {
  ...base,
  identity(testcase, suite) {
    const name = testcase.name.trim();
    const classname = testcase.classname?.trim() ?? '';
    const file = nonBlank(testcase.file);
    const suiteName = nonBlank(suite.name);
    // A file without a describe is a suite named "undefined".
    const suitePath =
      file !== undefined
        ? [file]
        : suiteName !== undefined && suiteName !== 'undefined'
          ? [suiteName]
          : undefined;
    return {
      ...(file === undefined ? {} : { file }),
      // Both default templates are "{classname} {title}": the classname repeats the name.
      context: classname === '' || classname === name ? [] : classname.split(PLAYWRIGHT_SEPARATOR),
      name: name.split(PLAYWRIGHT_SEPARATOR),
      ...(suitePath === undefined ? {} : { suitePath }),
    };
  },
  startedAt(suite) {
    const timestamp = nonBlank(suite.timestamp);
    // jest-junit writes UTC without an offset.
    return timestamp === undefined || UTC_OFFSET.test(timestamp) ? timestamp : `${timestamp}Z`;
  },
};

const pytest: DialectMapping = {
  ...base,
  // The classname is the module path: the `file` attribute of xunit1 would change every key.
  identity(testcase) {
    const parts = classAndName(testcase);
    const classname = parts.context[0];
    return { ...parts, ...(classname === undefined ? {} : { suitePath: classname.split('.') }) };
  },
};

const surefire: DialectMapping = {
  ...base,
  identity(testcase) {
    const parts = classAndName(testcase);
    const classname = parts.context[0];
    // `LoginTest$Session$Refresh`: the top-level class, then the nested ones.
    return { ...parts, ...(classname === undefined ? {} : { suitePath: classname.split('$') }) };
  },
};

const playwright: DialectMapping = {
  ...base,
  identity(testcase, suite) {
    const project = nonBlank(suite.hostname);
    const prefix = project === undefined ? undefined : `[${project}] `;
    const name =
      prefix !== undefined && testcase.name.startsWith(prefix)
        ? testcase.name.slice(prefix.length)
        : testcase.name;
    const file = nonBlank(testcase.classname);
    return {
      ...(file === undefined ? {} : { file }),
      context: [],
      name: name.split(PLAYWRIGHT_SEPARATOR),
      ...(project === undefined ? {} : { parameters: { project } }),
    };
  },
  skipReason: (testcase, outcome) =>
    nonBlank(outcome.message) ??
    nonBlank(testcase.properties.find((property) => property.name === 'skip')?.value),
};

const GO_OUTPUT_MARKER = /^(?:===|---) /;
const GO_LOCATION = /^\s*\S+\.go:\d+: ?/;

function isFailed(testcase: JUnitTestCase): boolean {
  return testcase.outcomes.some(({ kind }) => kind === 'failure' || kind === 'error');
}

const gotestsum: DialectMapping = {
  ...base,
  // A parent test is a testcase too. Keep it only when it failed and none of its subtests did.
  testcases(suite) {
    // Every ancestor name of each testcase: whether it has subtests, and whether one failed.
    const parents = new Map<string, { failedSubtest: boolean }>();
    for (const testcase of suite.testcases) {
      const segments = testcase.name?.split('/') ?? [];
      for (let depth = 1; depth < segments.length; depth += 1) {
        const parent = segments.slice(0, depth).join('/');
        const entry = parents.get(parent) ?? { failedSubtest: false };
        entry.failedSubtest ||= isFailed(testcase);
        parents.set(parent, entry);
      }
    }
    return suite.testcases.filter((testcase) => {
      const parent = testcase.name === undefined ? undefined : parents.get(testcase.name);
      return parent === undefined || (isFailed(testcase) && !parent.failedSubtest);
    });
  },
  identity(testcase) {
    const classname = testcase.classname?.trim() ?? '';
    return { context: classname === '' ? [] : [classname], name: testcase.name.split('/') };
  },
  // The message is always "Failed"; the body is the test's output.
  error: (outcome) => (outcome.body === undefined ? undefined : { stack: outcome.body }),
  // The message holds the whole `=== RUN` / `x_test.go:22: <reason>` / `--- SKIP` output.
  skipReason(_testcase, outcome) {
    const lines = (outcome.message ?? '')
      .split('\n')
      .filter((line) => line.trim() !== '' && !GO_OUTPUT_MARKER.test(line))
      .map((line) => line.replace(GO_LOCATION, '').trim());
    return nonBlank(lines.join('\n'));
  },
};

export const DIALECT_MAPPINGS: Readonly<Record<JUnitDialect, DialectMapping>> = {
  jest,
  pytest,
  playwright,
  surefire,
  gotestsum,
  generic: base,
};
