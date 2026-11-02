import { describe, expect, it } from 'vitest';
import { isStepKeyword, tableText } from './gherkin-steps.js';

describe('isStepKeyword', () => {
  it('accepts the English step keywords and the wildcard, and nothing else', () => {
    for (const keyword of ['Given', 'When', 'Then', 'And', 'But', '*']) {
      expect(isStepKeyword(keyword)).toBe(true);
    }
    for (const keyword of ['given', 'Soit', 'Dado', 'Given ', '']) {
      expect(isStepKeyword(keyword)).toBe(false);
    }
  });
});

describe('tableText', () => {
  it('renders each row as a Gherkin table line', () => {
    expect(
      tableText([
        ['item', 'price'],
        ['book', '12'],
      ]),
    ).toBe('| item | price |\n| book | 12 |');
  });

  it('escapes the pipes, backslashes and newlines a cell holds, so the table reads back', () => {
    expect(tableText([['a|b', 'c\\d', 'line one\nline two']])).toBe(
      '| a\\|b | c\\\\d | line one\\nline two |',
    );
  });

  it('keeps an empty cell as an empty column', () => {
    expect(tableText([['a', '', 'c']])).toBe('| a |  | c |');
  });
});
