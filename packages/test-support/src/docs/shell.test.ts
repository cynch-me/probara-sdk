import { describe, expect, it } from 'vitest';
import { fileGuardOf, logicalLines, shellLineOf } from './shell.js';

describe('the command lines of a code block', () => {
  it.each([
    ['if [ -f probara-results.json ]; then probara import results probara-results.json; fi'],
    ['[ -f probara-results.json ] && probara import results probara-results.json'],
    ['test -f probara-results.json && probara import results probara-results.json'],
    ['- run: test -f probara-results.json && probara import results probara-results.json'],
  ])('drop the file guard of %j and name its file', (line) => {
    expect(shellLineOf(line)).toBe('probara import results probara-results.json');
    expect(fileGuardOf(line.replace(/^- run: /, ''))).toBe('probara-results.json');
  });

  it('have no guard without one', () => {
    expect(fileGuardOf('probara import results other.json')).toBeUndefined();
  });

  it('join continuations, keeping the line each command starts on', () => {
    expect(
      logicalLines({
        line: 10,
        content: 'probara import junit \\\n  junit.xml\nprobara run close',
      }),
    ).toEqual([
      { line: 11, text: 'probara import junit  junit.xml' },
      { line: 13, text: 'probara run close' },
    ]);
  });
});
