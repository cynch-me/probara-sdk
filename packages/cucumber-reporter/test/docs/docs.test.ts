/**
 * The formatter's docs, tested as the other packages' docs are: every link resolves and stays inside
 * the package, the options tables equal the formatter's options (names and types), and the quick
 * start runs in a real cucumber-js and reports to the project its configuration names.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brokenLinks, linksLeavingPackage } from '@probara/test-support/docs/links';
import { optionsOf } from '@probara/test-support/docs/options';
import { fencedBlocks, packageDocs, tableAfter } from '@probara/test-support/docs/markdown';
import { startFakeProbara } from '@probara/test-support/fake-probara';
import { STEPS } from '../support/project.js';
import { createWorkspace, PACKAGE_DIR, TOKEN } from '../support/workspace.js';

const README = join(PACKAGE_DIR, 'README.md');
const CONFIGURATION = join(PACKAGE_DIR, 'docs', 'configuration.md');

/** The rows of a table by option name (the order of the rows is not the contract), with their types. */
function rowsOf(marker: string): { name: string; type: string }[] {
  return tableAfter(readFileSync(CONFIGURATION, 'utf8'), marker)
    .map((cells) => ({
      name: (cells[0] ?? '').replace(/^`|`$/g, ''),
      type: (cells[2] ?? '').replace(/\\\|/g, '|').replace(/^`|`$/g, ''),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The options of the formatter by name, sorted like the rows of a table. */
function sortedByName(options: { name: string; type: string }[]): { name: string; type: string }[] {
  return [...options].sort((a, b) => a.name.localeCompare(b.name));
}

describe('the formatter docs', { timeout: 120_000 }, () => {
  it.each(packageDocs(PACKAGE_DIR))(
    '%s: every link resolves, and stays inside the package',
    (file) => {
      expect(brokenLinks(file)).toEqual([]);
      expect(linksLeavingPackage(file, PACKAGE_DIR)).toEqual([]);
    },
  );

  it('has one row per option of the formatter, with its type', () => {
    // `clientName` is core's option for the adapter's own name: the formatter sets it, and a user's
    // value is overwritten, so the table has no row for it (the configuration page says so).
    const options = optionsOf(PACKAGE_DIR, 'ProbaraCucumberOptions')
      .filter((option) => !option.runtime && option.name !== 'clientName')
      .map(({ name, type }) => ({ name, type }));
    expect(rowsOf('options-table')).toEqual(sortedByName(options));
  });

  it('has one row per seam of core the formatter takes, with its type', () => {
    const seams = optionsOf(PACKAGE_DIR, 'ProbaraCucumberOptions')
      .filter((option) => option.runtime)
      .map(({ name, type }) => ({ name, type }));
    expect(rowsOf('runtime-options-table')).toEqual(sortedByName(seams));
  });

  it('runs the quick start in a real cucumber-js, and reports to the project it names', async () => {
    const config = fencedBlocks(readFileSync(README, 'utf8')).find((block) =>
      block.content.startsWith('// cucumber.js'),
    );
    if (config === undefined) throw new Error('the README has no cucumber.js quick start');
    const fake = await startFakeProbara({ token: TOKEN });
    const ws = await createWorkspace({
      'cucumber.js': config.content,
      'features/support/steps.js': STEPS,
      'features/cart.feature':
        'Feature: Cart\n  Scenario: Add a book\n    Given a cart with a book\n',
    });
    try {
      const run = await ws.cucumber([], {
        PROBARA_API_TOKEN: TOKEN,
        PROBARA_BASE_URL: fake.baseUrl,
      });
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe('');
      expect(fake.requestsTo('report').map((request) => request.projectId)).toEqual(['SHOP']);
      expect(
        fake.reports().flatMap((report) => report.results.map((result) => result.automationKey)),
      ).toEqual(['features/cart.feature > Cart > Add a book']);
    } finally {
      await ws.remove();
      await fake.close();
    }
  });
});
