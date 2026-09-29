import { describe, expect, it } from 'vitest';
import { readFixture } from '../../test/fixtures.js';
import { JUnitParseError, parseJUnit } from './parse.js';

function parseError(xml: string, filePath = 'reports/junit.xml'): JUnitParseError {
  try {
    parseJUnit(xml, filePath);
  } catch (error) {
    if (error instanceof JUnitParseError) return error;
    throw error;
  }
  throw new Error('expected parseJUnit to throw');
}

describe('parseJUnit', () => {
  it('reads suites, testcases, outcomes, properties and output of a testsuites root', () => {
    const document = parseJUnit(
      `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="all">
  <testsuite name="login" timestamp="2026-09-29T10:00:00Z" hostname="ci">
    <properties><property name="go.version" value="go1.27"/></properties>
    <testcase name="passes" classname="Login" file="login.test.ts" time="0.25"/>
    <testcase name="fails" classname="Login" time="1">
      <properties>
        <property name="probara_case" value="PRB-1"/>
        <property name="note">text value</property>
      </properties>
      <failure message="boom &amp; bust" type="AssertionError">stack &lt;line&gt;
  at x</failure>
      <system-out>out line</system-out>
      <system-err><![CDATA[err <raw> line]]></system-err>
    </testcase>
    <system-out>suite output</system-out>
  </testsuite>
</testsuites>`,
      'junit.xml',
    );

    expect(document.root).toBe('testsuites');
    expect(document.attributes).toEqual({ name: 'all' });
    expect(document.suites).toHaveLength(1);
    const [suite] = document.suites;
    expect(suite).toMatchObject({
      name: 'login',
      timestamp: '2026-09-29T10:00:00Z',
      hostname: 'ci',
      properties: [{ name: 'go.version', value: 'go1.27' }],
      systemOut: ['suite output'],
      systemErr: [],
    });
    expect(suite?.testcases).toEqual([
      {
        name: 'passes',
        classname: 'Login',
        file: 'login.test.ts',
        time: 0.25,
        properties: [],
        outcomes: [],
        systemOut: [],
        systemErr: [],
      },
      {
        name: 'fails',
        classname: 'Login',
        time: 1,
        properties: [
          { name: 'probara_case', value: 'PRB-1' },
          { name: 'note', value: 'text value' },
        ],
        outcomes: [
          {
            kind: 'failure',
            message: 'boom & bust',
            type: 'AssertionError',
            body: 'stack <line>\n  at x',
            systemOut: [],
            systemErr: [],
          },
        ],
        systemOut: ['out line'],
        systemErr: ['err <raw> line'],
      },
    ]);
  });

  it('reads a testsuite root and its nested testsuites', () => {
    const document = parseJUnit(
      `<testsuite name="outer"><testcase name="a"/><testsuite name="inner"><testcase name="b"/><testcase name="c"/></testsuite></testsuite>`,
      'nested.xml',
    );

    expect(document.root).toBe('testsuite');
    expect(document.suites.map((suite) => suite.name)).toEqual(['outer', 'inner']);
    expect(
      document.suites.map((suite) => suite.testcases.map((testcase) => testcase.name)),
    ).toEqual([['a'], ['b', 'c']]);
  });

  it('decodes numeric character references in attributes and bodies', () => {
    const document = parseJUnit(
      `<testsuites><testsuite name="go"><testcase name="t"><failure message="Failed" type="">=== RUN   t&#xA;    x_test.go:17: got &#34;a&#34;&#10;&#x9;tab</failure><skipped message="line 1&#xA;line 2"/></testcase></testsuite></testsuites>`,
      'go.xml',
    );

    const outcomes = document.suites[0]?.testcases[0]?.outcomes;
    expect(outcomes?.[0]?.body).toBe('=== RUN   t\n    x_test.go:17: got "a"\n\ttab');
    expect(outcomes?.[1]).toMatchObject({ kind: 'skipped', message: 'line 1\nline 2' });
  });

  it('keeps every repeated output element and the attempts of reruns', () => {
    const document = parseJUnit(
      `<testsuite name="s"><testcase name="t">
<flakyFailure message="first" type="AssertionError" time="0.5"><stackTrace><![CDATA[trace 1]]></stackTrace><system-out>attempt 1</system-out></flakyFailure>
<flakyError message="second"><stackTrace>trace 2</stackTrace></flakyError>
<system-out>a</system-out><system-out>b</system-out>
</testcase></testsuite>`,
      'rerun.xml',
    );

    const testcase = document.suites[0]?.testcases[0];
    expect(testcase?.systemOut).toEqual(['a', 'b']);
    expect(testcase?.outcomes).toEqual([
      {
        kind: 'flakyFailure',
        message: 'first',
        type: 'AssertionError',
        stackTrace: 'trace 1',
        systemOut: ['attempt 1'],
        systemErr: [],
      },
      {
        kind: 'flakyError',
        message: 'second',
        stackTrace: 'trace 2',
        systemOut: [],
        systemErr: [],
      },
    ]);
  });

  it('keeps outcomes and nested suites in document order', () => {
    const document = parseJUnit(
      `<testsuite name="outer"><testcase name="t"><flakyError message="1"/><flakyFailure message="2"/><flakyError message="3"/></testcase><testsuite name="inner"><testcase name="b"/></testsuite><testcase name="c"/></testsuite>`,
      'order.xml',
    );

    expect(document.suites[0]?.testcases[0]?.outcomes.map((outcome) => outcome.message)).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(
      document.suites.map((suite) => suite.testcases.map((testcase) => testcase.name)),
    ).toEqual([['t', 'c'], ['b']]);
  });

  it('rejects names that could pollute prototypes as a parse error', () => {
    expect(parseError('<testsuite __proto__="x"/>', 'proto.xml').message).toMatch(
      /^proto\.xml: could not be read as XML \(/,
    );
    expect(parseError('<testsuites><constructor/></testsuites>', 'proto.xml')).toBeInstanceOf(
      JUnitParseError,
    );
  });

  it('parses a real report without an XML declaration', () => {
    const document = parseJUnit(readFixture('playwright', 'junit.xml'), 'junit.xml');

    expect(document.attributes).toMatchObject({ id: '', name: '' });
    expect(document.suites[0]?.testcases).toHaveLength(13);
  });

  it('returns no suites for an empty testsuites root', () => {
    expect(parseJUnit('<testsuites tests="0"/>', 'empty.xml').suites).toEqual([]);
    expect(parseJUnit('<testsuites>\n</testsuites>', 'empty.xml').suites).toEqual([]);
  });

  it('rejects a document that is not well-formed XML, naming the file', () => {
    const error = parseError('this is not xml', 'reports/broken.xml');
    expect(error.filePath).toBe('reports/broken.xml');
    expect(error.message).toMatch(/^reports\/broken\.xml: not well-formed XML \(line 1/);

    expect(parseError('<testsuites><testsuite></testsuites>').message).toMatch(
      /not well-formed XML/,
    );
    expect(parseError('').message).toMatch(/not well-formed XML/);
  });

  it('never echoes a huge document in its errors', () => {
    const huge = `<${'x'.repeat(100_000)}>`;
    expect(parseError(huge).message.length).toBeLessThan(300);
    expect(parseError(`<${'a'.repeat(100_000)}/>`).message.length).toBeLessThan(300);
  });

  it('rejects a well-formed document that is not JUnit', () => {
    expect(parseError('<html><body/></html>', 'page.xml').message).toBe(
      'page.xml: not a JUnit report (the root element is <html>, expected <testsuites> or <testsuite>)',
    );
    expect(parseError('<testsuite/><testsuite/>', 'two.xml').message).toMatch(
      /^two\.xml: not a JUnit report/,
    );
  });

  it('never expands entities a DTD declares', () => {
    const laughs = Array.from(
      { length: 9 },
      (_, level) => `<!ENTITY lol${level + 1} "${`&lol${level};`.repeat(10)}">`,
    ).join('');
    const document = parseJUnit(
      `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol0 "lol">${laughs}]><testsuites><testsuite name="&lol9;"><testcase name="t &lol1;"/></testsuite></testsuites>`,
      'laughs.xml',
    );

    expect(document.suites[0]?.name).toBe('&lol9;');
    expect(document.suites[0]?.testcases[0]?.name).toBe('t &lol1;');
  });
});
