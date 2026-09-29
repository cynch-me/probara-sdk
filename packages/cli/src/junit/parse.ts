import { XMLParser, XMLValidator, type EntityDecoderOptions } from 'fast-xml-parser';
import type {
  JUnitDocument,
  JUnitOutcome,
  JUnitOutcomeKind,
  JUnitProperty,
  JUnitSuite,
  JUnitTestCase,
} from './model.js';

/** A file that is not well-formed XML or not a JUnit report. The message names the file. */
export class JUnitParseError extends Error {
  override readonly name = 'JUnitParseError';

  constructor(
    readonly filePath: string,
    reason: string,
  ) {
    super(`${filePath}: ${reason}`);
  }
}

const ATTRIBUTES = ':@';
const TEXT = '#text';
const MAX_ECHO_LENGTH = 80;
/** How deep `testsuite` elements may nest: no real report comes close, and the walk recurses. */
const MAX_SUITE_DEPTH = 64;
/**
 * How deep any element may nest (the default of fast-xml-parser 5, set so it never changes under
 * an update): the suites of {@link MAX_SUITE_DEPTH} levels and their testcases fit well within it.
 */
const MAX_NESTED_ELEMENTS = 100;

const OUTCOME_KINDS: ReadonlySet<string> = new Set<JUnitOutcomeKind>([
  'failure',
  'error',
  'skipped',
  'flakyFailure',
  'flakyError',
  'rerunFailure',
  'rerunError',
]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};
const ENTITY_REFERENCE = /&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos));/g;

function fromCodePoint(codePoint: number): string {
  return codePoint > 0x10ffff ? '\uFFFD' : String.fromCodePoint(codePoint);
}

/**
 * Decodes only the 5 predefined XML entities and numeric character references. Entities a DTD
 * declares are never expanded (no "billion laughs"): they stay as written.
 */
const entityDecoder: EntityDecoderOptions = {
  setExternalEntities: () => undefined,
  addInputEntities: () => undefined,
  reset: () => undefined,
  setXmlVersion: () => undefined,
  decode: (text) =>
    text.replace(
      ENTITY_REFERENCE,
      (_match, decimal: string | undefined, hex: string | undefined, name: string | undefined) =>
        name !== undefined
          ? (NAMED_ENTITIES[name] ?? '')
          : fromCodePoint(decimal === undefined ? parseInt(hex ?? '', 16) : parseInt(decimal, 10)),
    ),
};

// `preserveOrder` keeps every element and text run in document order: `[{ tag: [...children],
// ':@': { attributes } }, { '#text': '...' }]`.
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: TEXT,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  processEntities: true,
  entityDecoder,
  maxNestedTags: MAX_NESTED_ELEMENTS,
});

type XmlEntry = Record<string, unknown>;

interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlEntry[];
}

function isEntry(value: unknown): value is XmlEntry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function elementOf(entry: XmlEntry): XmlElement | undefined {
  const name = Object.keys(entry).find((key) => key !== ATTRIBUTES && key !== TEXT);
  if (name === undefined) return undefined;
  const children = entry[name];
  const rawAttributes = entry[ATTRIBUTES];
  const attributes: Record<string, string> = {};
  if (isEntry(rawAttributes)) {
    for (const [attribute, value] of Object.entries(rawAttributes)) {
      if (typeof value === 'string') attributes[attribute] = value;
    }
  }
  return { name, attributes, children: Array.isArray(children) ? children.filter(isEntry) : [] };
}

function elementsOf(entries: readonly XmlEntry[]): XmlElement[] {
  return entries.map(elementOf).filter((element) => element !== undefined);
}

function childElements(element: XmlElement, name?: string): XmlElement[] {
  const elements = elementsOf(element.children);
  return name === undefined ? elements : elements.filter((child) => child.name === name);
}

/** The text content of an element: its text runs and CDATA sections, in order. */
function textOf(element: XmlElement): string {
  return element.children
    .map((entry) => entry[TEXT])
    .filter((text) => typeof text === 'string')
    .join('');
}

function childTexts(element: XmlElement, name: string): string[] {
  return childElements(element, name).map(textOf);
}

function nonBlank(text: string | undefined): string | undefined {
  return text === undefined || text.trim() === '' ? undefined : text;
}

function propertiesOf(element: XmlElement): JUnitProperty[] {
  return childElements(element, 'properties')
    .flatMap((properties) => childElements(properties, 'property'))
    .flatMap((property) => {
      const { name, value } = property.attributes;
      if (name === undefined) return [];
      return [{ name, value: value ?? textOf(property).trim() }];
    });
}

function toOutcome(element: XmlElement): JUnitOutcome {
  const { message, type } = element.attributes;
  const body = nonBlank(textOf(element));
  const stackTrace = nonBlank(childTexts(element, 'stackTrace').join('\n'));
  return {
    kind: element.name as JUnitOutcomeKind,
    ...(message === undefined ? {} : { message }),
    ...(type === undefined ? {} : { type }),
    ...(body === undefined ? {} : { body }),
    ...(stackTrace === undefined ? {} : { stackTrace }),
    systemOut: childTexts(element, 'system-out'),
    systemErr: childTexts(element, 'system-err'),
  };
}

function toTestCase(element: XmlElement): JUnitTestCase {
  const { name, classname, file, time } = element.attributes;
  const seconds = time === undefined || time.trim() === '' ? NaN : Number(time);
  return {
    ...(name === undefined ? {} : { name }),
    ...(classname === undefined ? {} : { classname }),
    ...(file === undefined ? {} : { file }),
    ...(Number.isFinite(seconds) ? { time: seconds } : {}),
    properties: propertiesOf(element),
    outcomes: childElements(element)
      .filter((child) => OUTCOME_KINDS.has(child.name))
      .map(toOutcome),
    systemOut: childTexts(element, 'system-out'),
    systemErr: childTexts(element, 'system-err'),
  };
}

/** Collects `element` and its nested suites, in document order; `depth` 1 is the outermost suite. */
function collectSuites(
  element: XmlElement,
  suites: JUnitSuite[],
  depth: number,
  filePath: string,
): void {
  if (depth > MAX_SUITE_DEPTH) {
    throw new JUnitParseError(
      filePath,
      `not a JUnit report (testsuite elements nested deeper than ${String(MAX_SUITE_DEPTH)} levels)`,
    );
  }
  const { attributes } = element;
  const { name, timestamp, hostname } = attributes;
  suites.push({
    ...(name === undefined ? {} : { name }),
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(hostname === undefined ? {} : { hostname }),
    attributes,
    properties: propertiesOf(element),
    systemOut: childTexts(element, 'system-out'),
    systemErr: childTexts(element, 'system-err'),
    testcases: childElements(element, 'testcase').map(toTestCase),
  });
  for (const nested of childElements(element, 'testsuite')) {
    collectSuites(nested, suites, depth + 1, filePath);
  }
}

function echo(text: string): string {
  return text.length > MAX_ECHO_LENGTH ? `${text.slice(0, MAX_ECHO_LENGTH)}…` : text;
}

function notJUnit(found: string): string {
  return `not a JUnit report (${found}, expected <testsuites> or <testsuite>)`;
}

function parseEntries(xml: string, filePath: string): XmlEntry[] {
  // The parser alone accepts unclosed tags and stray text, so check well-formedness first. The
  // validator bundled with fast-xml-parser 5 is deprecated in favor of a separate package; it is
  // still shipped and maintained, and it saves a dependency.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    const { line, col, msg } = validation.err;
    const position = [
      `line ${String(line)}`,
      ...(Number.isFinite(col) ? [`column ${String(col)}`] : []),
    ];
    throw new JUnitParseError(
      filePath,
      `not well-formed XML (${position.join(', ')}: ${echo(msg)})`,
    );
  }
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch (error) {
    // Such as a `__proto__` element or attribute, which the parser refuses.
    const reason = error instanceof Error ? error.message : String(error);
    throw new JUnitParseError(filePath, `could not be read as XML (${echo(reason)})`);
  }
  return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
}

/**
 * Parses a JUnit XML report into the neutral model.
 *
 * @throws JUnitParseError when the text is not well-formed XML, its root element is neither
 * `testsuites` nor `testsuite`, or its elements nest too deep.
 */
export function parseJUnit(xml: string, filePath: string): JUnitDocument {
  const roots = elementsOf(parseEntries(xml, filePath));
  const [root] = roots;
  if (roots.length !== 1 || root === undefined) {
    throw new JUnitParseError(filePath, notJUnit('several root elements'));
  }
  const rootName = root.name;
  if (rootName !== 'testsuites' && rootName !== 'testsuite') {
    throw new JUnitParseError(filePath, notJUnit(`the root element is <${echo(rootName)}>`));
  }

  const suites: JUnitSuite[] = [];
  const outermost = rootName === 'testsuite' ? [root] : childElements(root, 'testsuite');
  for (const suite of outermost) collectSuites(suite, suites, 1, filePath);
  return { root: rootName, attributes: root.attributes, suites };
}
