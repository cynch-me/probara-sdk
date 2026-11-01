/**
 * `probara import cucumber <file.json...>`: Cucumber JSON reports sent to the fake Probara as results
 * of the scenarios their feature files define.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixturePath } from './fixtures.js';
import { configuredEnv, runCli, TOKEN, type CliRun } from './support/run-cli.js';

const SOURCE = fixturePath('cucumber', 'source');
const REPORT = fixturePath('cucumber', 'cucumber.json');

let fake: FakeProbara;
let dir: string;

beforeEach(async () => {
  fake = await startFakeProbara({ token: TOKEN });
  dir = await mkdtemp(join(tmpdir(), 'probara-import-cucumber-'));
});

afterEach(async () => {
  await fake.close();
  await rm(dir, { recursive: true, force: true });
});

/** Runs the CLI against the fake, configured by the environment; the token never shows. */
async function cli(
  args: readonly string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<CliRun> {
  return runCli(args, {
    env: configuredEnv(fake.baseUrl, options.env),
    cwd: options.cwd ?? SOURCE,
  });
}

/** A one-scenario report whose feature file is not in the project. */
function reportOfMissingFile(): string {
  return JSON.stringify([
    {
      uri: 'features/missing.feature',
      name: 'Shop',
      keyword: 'Feature',
      line: 1,
      elements: [
        {
          type: 'scenario',
          keyword: 'Scenario',
          name: 'Buy',
          line: 3,
          steps: [
            {
              keyword: 'Given ',
              name: 'a book',
              line: 4,
              result: { status: 'passed', duration: 1000 },
            },
          ],
        },
      ],
    },
  ]);
}

describe('probara import cucumber', () => {
  it('sends each scenario as a result under the key the sync gives it, with keyword steps and outline parameters', async () => {
    const run = await cli(['import', 'cucumber', REPORT, '--run-name', 'Cucumber']);

    expect(run.exitCode).toBe(0);
    const [report] = fake.reports();
    const results = report?.results ?? [];
    expect(results).toHaveLength(10);

    expect(results[0]).toMatchObject({
      automationKey: 'features/cart/cart.feature > Cart > Add a book',
      title: 'Add a book',
      status: 'passed',
      suitePath: ['features', 'cart', 'Cart'],
    });
    expect(results[0]?.steps?.map((step) => [step.action, step.keyword])).toEqual([
      ['a cart with a book', 'Given'],
      ['the cart shows one item', 'Then'],
    ]);

    const rows = results.filter((result) => result.title === 'Pay with <method>');
    expect(rows.map((row) => row.parameters)).toEqual([
      { method: 'visa', amount: '12' },
      { method: 'paypal', amount: '30' },
    ]);
    expect(rows.map((row) => row.automationKey)).toEqual([
      'features/checkout/pay.feature > Checkout > Pay with <method>',
      'features/checkout/pay.feature > Checkout > Pay with <method>',
    ]);
  });

  it('nests the Background steps of a scenario under one Background step', async () => {
    await cli(['import', 'cucumber', REPORT, '--run-name', 'Cucumber']);

    const [report] = fake.reports();
    const saved = report?.results.find((result) => result.title === 'Pay with the saved card');
    expect(saved?.steps).toMatchObject([
      {
        action: 'Background',
        status: 'passed',
        steps: [{ action: 'a cart with a book', keyword: 'Given', status: 'passed' }],
      },
      { action: 'the customer pays with the saved card', keyword: 'When', status: 'passed' },
      { action: 'the order is confirmed', keyword: 'Then' },
    ]);
  });

  it('sends the data of a Doc String and a Data Table, the failure of a step, and the status of each scenario', async () => {
    await cli(['import', 'cucumber', REPORT, '--run-name', 'Cucumber']);

    const results = fake.reports()[0]?.results ?? [];
    const receipt = results.find((result) => result.title === 'Send the receipt');
    expect(
      receipt?.steps?.find((step) => step.action === 'the customer sends the receipt:'),
    ).toMatchObject({
      data: 'Thank you for the order.',
    });
    expect(receipt?.steps?.find((step) => step.action === 'the receipt table is:')).toMatchObject({
      data: '| item | price |\n| book | 12 |',
    });
    const declined = results.find((result) => result.title === 'A declined card fails');
    expect(declined).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(declined)).toContain('The card was declined');
    expect(results.filter((result) => result.status === 'skipped')).toHaveLength(2);
  });

  it('keys a scenario by the names in the report when its feature file is not there, and says so', async () => {
    await writeFile(join(dir, 'report.json'), reportOfMissingFile());

    const run = await cli(['import', 'cucumber', 'report.json', '--run-name', 'Cucumber'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toContain(
      'features/missing.feature was not found: its scenarios are keyed by the names in the report',
    );
    expect(fake.reports()[0]?.results[0]).toMatchObject({
      automationKey: 'features/missing.feature > Shop > Buy',
      title: 'Buy',
    });
  });

  it('refuses a report that is not JSON, naming the file, and sends nothing', async () => {
    await writeFile(join(dir, 'broken.json'), '[ nope');

    const run = await cli(['import', 'cucumber', 'broken.json'], { cwd: dir });

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('broken.json: is not valid JSON');
    expect(fake.requestsTo('report')).toHaveLength(0);
  });

  it('refuses a feature file that does not parse, naming its place, and sends nothing', async () => {
    await mkdir(join(dir, 'features'));
    await writeFile(join(dir, 'features', 'bad.feature'), '# language: xx\nFeature: Shop\n');
    await writeFile(
      join(dir, 'report.json'),
      JSON.stringify([
        {
          uri: 'features/bad.feature',
          name: 'Shop',
          elements: [{ type: 'scenario', keyword: 'Scenario', name: 'Buy', line: 3, steps: [] }],
        },
      ]),
    );

    const run = await cli(['import', 'cucumber', 'report.json'], { cwd: dir });

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('features/bad.feature:1:1: Language not supported: xx');
    expect(fake.requestsTo('report')).toHaveLength(0);
  });

  it('prints the dry run of each result, and sends nothing', async () => {
    const run = await cli(['import', 'cucumber', REPORT, '--dry-run']);

    expect(run.exitCode).toBe(0);
    expect(fake.requestsTo('report')).toHaveLength(0);
    expect(run.stdout).toContain('passed\t-\tfeatures/cart/cart.feature > Cart > Add a book');
    expect(run.stderr).toContain('Dry run: nothing was sent');
  });

  it('exits 3 with --fail-on-failed-tests when a scenario failed, after sending the results', async () => {
    const run = await cli([
      'import',
      'cucumber',
      REPORT,
      '--run-name',
      'Cucumber',
      '--fail-on-failed-tests',
    ]);

    expect(run.exitCode).toBe(3);
    expect(fake.reports()).toHaveLength(1);
  });

  it('never prints the token', async () => {
    const run = await cli(['import', 'cucumber', REPORT, '--run-name', 'Cucumber']);

    expect(`${run.stdout}${run.stderr}`).not.toContain(TOKEN);
  });
});
