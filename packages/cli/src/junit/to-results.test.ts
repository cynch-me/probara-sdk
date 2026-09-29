import { buildAutomationKey, type TestResultInput } from '@probara/core';
import { describe, expect, it } from 'vitest';
import { fixturePath, readFixture } from '../../test/fixtures.js';
import { JUnitParseError } from './parse.js';
import { junitToResults } from './to-results.js';

const keys = (results: readonly TestResultInput[]) =>
  results.map((result) => buildAutomationKey(result.identity, { rootDir: '/' }));

describe('junitToResults', () => {
  it('maps a report of an unknown tool with the generic dialect', () => {
    const { dialect, results } = junitToResults(
      `<testsuites><testsuite name="unit" timestamp="2026-09-29T10:00:00+02:00">
<testcase classname="com.example.CartTest" name="adds an item" time="1.5"/>
<testcase classname="Cart" name="Cart.removes an item"/>
<testcase name="has no classname"/>
</testsuite></testsuites>`,
      { filePath: 'report.xml' },
    );

    expect(dialect).toBe('generic');
    expect(keys(results)).toEqual([
      'com.example.CartTest > adds an item',
      'Cart.removes an item',
      'has no classname',
    ]);
    expect(results[0]).toMatchObject({
      status: 'passed',
      durationMs: 1500,
      startedAt: '2026-09-29T10:00:00+02:00',
      suitePath: ['com.example.CartTest'],
    });
    expect(results[2]?.suitePath).toBeUndefined();
  });

  it('lets an explicit dialect win over detection', () => {
    const xml = readFixture('playwright', 'junit.xml');
    const { dialect, results } = junitToResults(xml, { filePath: 'junit.xml', dialect: 'generic' });

    expect(dialect).toBe('generic');
    expect(keys(results)).toContain(
      'login.spec.js > login › session › refresh › renews the token before expiry',
    );
  });

  it('fans a test with several ids out into one result per id, with the same key', () => {
    const { results } = junitToResults(
      `<testsuite name="s"><testcase classname="Cart" name="PRB-2 [PRB-3] adds an item">
<properties><property name="probara_case" value="PRB-1, PRB-2"/></properties>
<failure message="boom"/>
</testcase></testsuite>`,
      { filePath: 'report.xml', projectCode: 'PRB' },
    );

    expect(results.map((result) => result.caseDisplayId)).toEqual(['PRB-1', 'PRB-2', 'PRB-3']);
    expect(new Set(keys(results))).toEqual(new Set(['Cart > adds an item']));
    expect(results.every((result) => result.status === 'failed')).toBe(true);
  });

  it('builds the same key with and without an id in the name', () => {
    const toKey = (name: string) =>
      keys(
        junitToResults(`<testsuite><testcase classname="Cart" name="${name}"/></testsuite>`, {
          filePath: 'report.xml',
          projectCode: 'PRB',
        }).results,
      );

    expect(toKey('adds an item (PRB-7)')).toEqual(toKey('adds an item'));
    expect(toKey('@PRB-7 adds an item')).toEqual(toKey('adds an item'));
  });

  it('reads only property ids without a project code', () => {
    const { results } = junitToResults(
      `<testsuite><testcase classname="Cart" name="PRB-2 adds an item"><properties><property name="probara_case" value="PRB-1"/></properties></testcase></testsuite>`,
      { filePath: 'report.xml' },
    );

    expect(results.map((result) => result.caseDisplayId)).toEqual(['PRB-1']);
    expect(keys(results)).toEqual(['Cart > PRB-2 adds an item']);
  });

  it('keeps the name when it holds nothing but an id', () => {
    const { results } = junitToResults(
      `<testsuite><testcase classname="Cart" name="PRB-9"/></testsuite>`,
      { filePath: 'report.xml', projectCode: 'PRB' },
    );
    expect(results[0]).toMatchObject({ caseDisplayId: 'PRB-9' });
    expect(keys(results)).toEqual(['Cart > PRB-9']);
  });

  it('counts every failed attempt of a flaky test, and a failure wins over an error', () => {
    const { results } = junitToResults(
      `<testsuite><testcase classname="Cart" name="flaky">
<flakyError><stackTrace>
  TimeoutError: gave up
    at cart.ts:3</stackTrace></flakyError>
<flakyFailure message="second"/>
</testcase>
<testcase classname="Cart" name="both"><error message="teardown"/><failure message="assertion"/></testcase>
</testsuite>`,
      { filePath: 'report.xml', errorStatus: 'blocked' },
    );

    expect(results[0]).toMatchObject({
      status: 'passed',
      notes: 'Passed after 2 failed attempts.\n\nFirst failure: TimeoutError: gave up',
    });
    expect(results[1]).toMatchObject({ status: 'failed', error: { message: 'assertion' } });
  });

  it('keeps a Go parent that failed on its own and drops the others', () => {
    const { results } = junitToResults(
      `<testsuites><testsuite name="example.com/shop" timestamp="2026-09-29T10:00:00Z">
<properties><property name="go.version" value="go1.27.1"/></properties>
<testcase classname="example.com/shop" name="TestCleanup" time="0.1"><failure message="Failed">cleanup failed</failure></testcase>
<testcase classname="example.com/shop" name="TestCleanup/runs" time="0.0"/>
<testcase classname="example.com/shop" name="TestCart" time="0.1"><failure message="Failed">--- FAIL</failure></testcase>
<testcase classname="example.com/shop" name="TestCart/adds" time="0.0"><failure message="Failed">want 1</failure></testcase>
<testcase classname="example.com/shop" name="TestCartSize" time="0.0"/>
<testcase classname="example.com/shop" name="TestPay" time="0.0"/>
<testcase classname="example.com/shop" name="TestPay/by_card" time="0.0"/>
</testsuite></testsuites>`,
      { filePath: 'report.xml' },
    );

    expect(keys(results)).toEqual([
      'example.com/shop > TestCleanup',
      'example.com/shop > TestCleanup > runs',
      'example.com/shop > TestCart > adds',
      'example.com/shop > TestCartSize',
      'example.com/shop > TestPay > by_card',
    ]);
    expect(results[0]).toMatchObject({ status: 'failed', error: { stack: 'cleanup failed' } });
  });

  it('attaches probara_attachment properties, next to the report or else in the working directory', () => {
    const report = fixturePath('playwright', 'report.xml');
    const cwd = fixturePath('playwright', 'source');
    const { results, warnings } = junitToResults(
      `<testsuite><testcase classname="Cart" name="adds"><properties>
<property name="probara_attachment" value="source/assets/server.log.txt"/>
<property name="probara_attachment" value="assets/pixel.png"/>
<property name="probara_attachment" value="${fixturePath('playwright', 'source', 'package.json')}"/>
<property name="probara_attachment" value="missing/trace.zip"/>
</properties></testcase></testsuite>`,
      { filePath: report, cwd },
    );

    expect(results[0]?.attachments).toEqual([
      {
        path: fixturePath('playwright', 'source', 'assets', 'server.log.txt'),
        contentType: 'text/plain',
      },
      {
        path: fixturePath('playwright', 'source', 'assets', 'pixel.png'),
        contentType: 'image/png',
      },
      {
        path: fixturePath('playwright', 'source', 'package.json'),
        contentType: 'application/json',
      },
      { path: fixturePath('playwright', 'missing', 'trace.zip'), contentType: 'application/zip' },
    ]);
    expect(warnings).toEqual([
      `${report}: attachment "missing/trace.zip" of "Cart > adds" was not found`,
    ]);
  });

  it('resolves a relative report path against the working directory', () => {
    const { results } = junitToResults(
      `<testsuite><testcase classname="Cart" name="adds"><system-out>[[ATTACHMENT|assets/pixel.png]]</system-out></testcase></testsuite>`,
      { filePath: 'source/report.xml', cwd: fixturePath('playwright') },
    );
    expect(results[0]?.attachments).toEqual([
      {
        path: fixturePath('playwright', 'source', 'assets', 'pixel.png'),
        contentType: 'image/png',
      },
    ]);
  });

  it('skips a testcase without a name, with a warning', () => {
    const { results, warnings } = junitToResults(
      `<testsuite><testcase classname="Cart"/><testcase classname="Cart" name="adds"/></testsuite>`,
      { filePath: 'report.xml' },
    );
    expect(keys(results)).toEqual(['Cart > adds']);
    expect(warnings).toEqual(['report.xml: skipped a testcase without a name (classname "Cart")']);
  });

  it('returns no results for an empty report', () => {
    expect(junitToResults('<testsuites/>', { filePath: 'empty.xml' })).toEqual({
      dialect: 'generic',
      results: [],
      warnings: [],
    });
  });

  it('throws a JUnitParseError for a file that is not JUnit', () => {
    expect(() => junitToResults('<html/>', { filePath: 'page.xml' })).toThrow(JUnitParseError);
  });
});
