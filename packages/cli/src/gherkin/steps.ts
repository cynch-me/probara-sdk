/** The English step keywords Probara reads, and the Data Table text a step's argument is sent as. */
import type { StepKeyword } from '@probara/core';

const STEP_KEYWORDS: ReadonlySet<string> = new Set(['Given', 'When', 'Then', 'And', 'But', '*']);

/** Whether `keyword` is one of the step keywords Probara reads: `Given`, `When`, `Then`, `And`, `But` or `*`. */
export function isStepKeyword(keyword: string): keyword is StepKeyword {
  return STEP_KEYWORDS.has(keyword);
}

/** A cell as Gherkin writes it: `\`, `|` and a newline escaped, so the table reads back to its cells. */
function cellText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, '\\n');
}

/** A Data Table as lines of `| cell | cell |`, one line per row. */
export function tableText(rows: readonly (readonly string[])[]): string {
  return rows.map((cells) => `| ${cells.map(cellText).join(' | ')} |`).join('\n');
}
