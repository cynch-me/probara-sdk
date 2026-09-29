/** The options table of `docs/configuration.md` is the options registry, row for row. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { optionLabel } from '../../src/help.js';
import { OPTIONS, type OptionSpec } from '../../src/options.js';
import { PACKAGE_DIR, read, tableAfter } from './markdown.js';

const NONE = '—';

/** A cell as a reader sees it: without the backticks around code. */
function plain(cell: string): string {
  return cell.replace(/`/g, '').replace(/\\\|/g, '|').trim();
}

function expectedRow(option: OptionSpec): string[] {
  return [
    optionLabel(option),
    option.type === 'list'
      ? `${option.description} (repeatable, or comma-separated)`
      : option.description,
    option.env ?? NONE,
    option.core ?? NONE,
    option.default ?? NONE,
    option.choices?.join(', ') ?? NONE,
    option.commands.join(', '),
  ];
}

describe('docs/configuration.md options table', () => {
  const rows = tableAfter(read(join(PACKAGE_DIR, 'docs', 'configuration.md')), 'options-table');

  it('has one row per option of the registry, in registry order', () => {
    expect(rows.map((row) => plain(row[0] ?? ''))).toEqual(OPTIONS.map(optionLabel));
  });

  it.each(OPTIONS.map((option) => [optionLabel(option), option] as const))(
    '%s: flag, description, variable, core option, default, values and commands',
    (_label, option) => {
      const row = rows.find((cells) => plain(cells[0] ?? '') === optionLabel(option));
      expect(row?.map(plain)).toEqual(expectedRow(option));
    },
  );
});
