/**
 * `probara sync gherkin <globs...>`: the scenarios of the `.feature` files of a repository, sent to
 * the fake Probara, which answers what each one became.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixturePath } from './fixtures.js';
import { configuredEnv, runCli, TOKEN, type CliRun } from './support/run-cli.js';

const SOURCE = fixturePath('cucumber', 'source');
const BACKGROUND = [{ keyword: 'Given', text: 'a cart with a book' }];
/** The Background of the scenarios under `Rule: Refunds`: the feature's, then the Rule's. */
const RULE_BACKGROUND = [...BACKGROUND, { keyword: 'Given', text: 'a paid order' }];
/** A Rule owns every scenario after its keyword, up to the next Rule: these four come after it. */
const UNDER_RULE = { rule: { name: 'Refunds', tags: [] }, background: RULE_BACKGROUND };

let fake: FakeProbara;
let dir: string;

beforeEach(async () => {
  fake = await startFakeProbara({ token: TOKEN });
  dir = await mkdtemp(join(tmpdir(), 'probara-sync-gherkin-'));
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

/** The sync request of the fixture project's `features/**` folder, as the CLI parses it. */
function fixtureSync() {
  return {
    scope: ['features/**/*.feature'],
    features: [
      {
        path: 'features/cart/cart.feature',
        name: 'Cart',
        description: 'The cart keeps what the customer chose.',
        tags: ['cart'],
        scenarios: [
          {
            automationKey: 'features/cart/cart.feature > Cart > Add a book',
            name: 'Add a book',
            line: 6,
            tags: ['smoke'],
            steps: [
              { keyword: 'Given', text: 'a cart with a book' },
              { keyword: 'Then', text: 'the cart shows one item' },
            ],
          },
        ],
      },
      {
        path: 'features/checkout/pay.feature',
        name: 'Checkout',
        description: 'Customers pay for their cart.',
        tags: ['checkout'],
        scenarios: [
          {
            automationKey: 'features/checkout/pay.feature > Checkout > Pay with the saved card',
            name: 'Pay with the saved card',
            line: 9,
            tags: ['smoke'],
            background: BACKGROUND,
            steps: [
              { keyword: 'When', text: 'the customer pays with the saved card' },
              { keyword: 'Then', text: 'the order is confirmed' },
            ],
          },
          {
            automationKey: 'features/checkout/pay.feature > Checkout > Pay with <method>',
            name: 'Pay with <method>',
            line: 13,
            tags: [],
            background: BACKGROUND,
            steps: [
              { keyword: 'When', text: 'the customer pays with <method>' },
              { keyword: 'Then', text: 'the order is confirmed for <amount>' },
            ],
            examples: [
              {
                name: 'Cards',
                header: ['method', 'amount'],
                rows: [
                  ['visa', '12'],
                  ['paypal', '30'],
                ],
              },
            ],
          },
          {
            automationKey: 'features/checkout/pay.feature > Checkout > Send the receipt',
            name: 'Send the receipt',
            line: 22,
            tags: [],
            background: BACKGROUND,
            steps: [
              {
                keyword: 'When',
                text: 'the customer sends the receipt:',
                argument: 'Thank you for the order.',
              },
              {
                keyword: 'And',
                text: 'the receipt table is:',
                argument: '| item | price |\n| book | 12 |',
              },
              { keyword: 'Then', text: 'the receipt is sent' },
            ],
          },
          {
            automationKey: 'features/checkout/pay.feature > Checkout > Refund a paid order',
            name: 'Refund a paid order',
            line: 36,
            tags: [],
            rule: { name: 'Refunds', tags: [] },
            background: RULE_BACKGROUND,
            steps: [
              { keyword: 'When', text: 'the customer asks for a refund' },
              { keyword: 'Then', text: 'the refund is issued' },
            ],
          },
          {
            automationKey: 'features/checkout/pay.feature > Checkout > A declined card fails',
            name: 'A declined card fails',
            line: 40,
            tags: [],
            ...UNDER_RULE,
            steps: [
              { keyword: 'When', text: 'the customer pays with a declined card' },
              { keyword: 'Then', text: 'the order is confirmed' },
            ],
          },
          {
            automationKey:
              'features/checkout/pay.feature > Checkout > A page with no step definition',
            name: 'A page with no step definition',
            line: 44,
            tags: [],
            ...UNDER_RULE,
            steps: [
              { keyword: 'When', text: 'the customer opens the gift page' },
              { keyword: 'Then', text: 'the page is shown' },
            ],
          },
          {
            automationKey:
              'features/checkout/pay.feature > Checkout > A step that is still pending',
            name: 'A step that is still pending',
            line: 48,
            tags: [],
            ...UNDER_RULE,
            steps: [{ keyword: 'Then', text: 'a future step is pending' }],
          },
          {
            automationKey:
              'features/checkout/pay.feature > Checkout > A step that matches two definitions',
            name: 'A step that matches two definitions',
            line: 51,
            tags: [],
            ...UNDER_RULE,
            steps: [{ keyword: 'Given', text: 'a step that matches two definitions' }],
          },
        ],
      },
    ],
  };
}

describe('probara sync gherkin', () => {
  it('sends the scenarios of the matched files with their keys and the scope, and prints the outcome', async () => {
    const run = await cli(['sync', 'gherkin', 'features/**/*.feature']);

    expect(run.exitCode).toBe(0);
    expect(fake.gherkinSyncs()).toEqual([fixtureSync()]);
    expect(run.stderr).toContain(
      'Created 9, updated 0, moved 0, restored 0, archived 0, unchanged 0',
    );
    expect(run.stderr).toContain('created  PRB-1  features/cart/cart.feature > Cart > Add a book');
    expect(run.stdout).toBe('');
  });

  it('expresses a directory as its feature files, and the paths relative to --root-dir', async () => {
    const run = await cli(['sync', 'gherkin', 'checkout', '--root-dir', SOURCE], {
      cwd: join(SOURCE, 'features'),
    });

    expect(run.exitCode).toBe(0);
    const [request] = fake.gherkinSyncs();
    expect(request?.scope).toEqual(['features/checkout/**/*.feature']);
    expect(request?.features.map((feature) => feature.path)).toEqual([
      'features/checkout/pay.feature',
    ]);
  });

  it('answers a dry run with what would be done, sends it as a dry run, and writes nothing', async () => {
    const dry = await cli(['sync', 'gherkin', 'features/**/*.feature', '--dry-run']);
    expect(dry.exitCode).toBe(0);
    expect(fake.gherkinSyncs()[0]).toMatchObject({ dryRun: true });
    expect(dry.stderr).toContain(
      'Would be created 9, updated 0, moved 0, restored 0, archived 0, unchanged 0',
    );

    const real = await cli(['sync', 'gherkin', 'features/**/*.feature']);
    expect(real.stderr).toContain(
      'Created 9, updated 0, moved 0, restored 0, archived 0, unchanged 0',
    );
  });

  it('prints --json as the answer of Probara', async () => {
    const run = await cli(['sync', 'gherkin', 'features/**/*.feature', '--json']);

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      dryRun: false,
      summary: { created: 9, updated: 0 },
    });
  });

  it('refuses two scenarios of one automation key, naming both lines, and sends nothing', async () => {
    await mkdir(join(dir, 'features'));
    await writeFile(
      join(dir, 'features', 'dup.feature'),
      [
        'Feature: Shop',
        '',
        '  Scenario: Pay',
        '    Given a cart',
        '',
        '  Scenario: Pay',
        '    Given a cart',
        '',
      ].join('\n'),
    );

    const run = await cli(['sync', 'gherkin', 'features/**/*.feature'], { cwd: dir });

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('features/dup.feature:3 and features/dup.feature:6');
    expect(fake.requestsTo('gherkinSync')).toHaveLength(0);
  });

  it('refuses a step keyword that is not English, naming its place, and sends nothing', async () => {
    await mkdir(join(dir, 'features'));
    await writeFile(
      join(dir, 'features', 'fr.feature'),
      [
        '# language: fr',
        'Fonctionnalité: Panier',
        '',
        '  Scénario: Achat',
        '    Soit un panier',
        '',
      ].join('\n'),
    );

    const run = await cli(['sync', 'gherkin', 'features/**/*.feature'], { cwd: dir });

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('features/fr.feature:5: the step keyword "Soit" is not English');
    expect(fake.requestsTo('gherkinSync')).toHaveLength(0);
  });

  it('refuses a file that does not parse, with the parser message and its place, and sends nothing', async () => {
    await mkdir(join(dir, 'features'));
    await writeFile(join(dir, 'features', 'bad.feature'), '# language: xx\nFeature: Shop\n');

    const run = await cli(['sync', 'gherkin', 'features/**/*.feature'], { cwd: dir });

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('features/bad.feature:1:1: Language not supported: xx');
    expect(fake.requestsTo('gherkinSync')).toHaveLength(0);
  });

  it('refuses a glob that matches no file, so a typo never archives a folder', async () => {
    const run = await cli(['sync', 'gherkin', 'nothing/**/*.feature']);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('No .feature file matched nothing/**/*.feature');
    expect(fake.requestsTo('gherkinSync')).toHaveLength(0);
  });

  it('refuses more than 1,000 scenarios, telling the user to sync each folder, and sends nothing', async () => {
    await mkdir(join(dir, 'features'));
    const scenarios = Array.from(
      { length: 1001 },
      (_, index) => `  Scenario: Case ${index}\n    Given a cart\n`,
    ).join('\n');
    await writeFile(join(dir, 'features', 'big.feature'), `Feature: Shop\n\n${scenarios}`);

    const run = await cli(['sync', 'gherkin', 'features/**/*.feature'], { cwd: dir });

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('at most 1,000 scenarios, this one has 1,001');
    expect(run.stderr).toContain('sync each folder with its own glob');
    expect(fake.requestsTo('gherkinSync')).toHaveLength(0);
  });

  it('sends the link of each scenario from --file-url, with its path and line filled in', async () => {
    await cli([
      'sync',
      'gherkin',
      'features/cart/cart.feature',
      '--file-url',
      'https://example.test/{path}#L{line}',
    ]);

    const [request] = fake.gherkinSyncs();
    expect(request?.features[0]?.scenarios[0]).toMatchObject({
      url: 'https://example.test/features/cart/cart.feature#L6',
    });
  });

  it('derives the link from the GitHub Actions environment when no --file-url is given', async () => {
    await cli(['sync', 'gherkin', 'features/cart/cart.feature'], {
      env: {
        GITHUB_ACTIONS: 'true',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'acme/shop',
        GITHUB_SHA: 'abc123',
      },
    });

    const [request] = fake.gherkinSyncs();
    expect(request?.features[0]?.scenarios[0]).toMatchObject({
      url: 'https://github.com/acme/shop/blob/abc123/features/cart/cart.feature#L6',
    });
  });

  it('sends the suite the feature suites go under, and no link outside a CI and without --file-url', async () => {
    await cli([
      'sync',
      'gherkin',
      'features/cart/cart.feature',
      '--suite-ulid',
      '01J9Z3K4M5N6P7Q8R9S0T1V2X9',
    ]);

    const [request] = fake.gherkinSyncs();
    expect(request).toMatchObject({ suiteUlid: '01J9Z3K4M5N6P7Q8R9S0T1V2X9' });
    expect(request?.features[0]?.scenarios[0]).not.toHaveProperty('url');
  });

  it('exits 1 when Probara refuses the sync, naming the reason, and never prints the token', async () => {
    fake.fail('gherkinSync', {
      status: 422,
      body: { error: { code: 'validation_failed', message: 'two scenarios bind one case' } },
    });

    const run = await cli(['sync', 'gherkin', 'features/**/*.feature']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      'Probara answered 422 validation_failed: two scenarios bind one case',
    );
    expect(`${run.stdout}${run.stderr}`).not.toContain(TOKEN);
  });

  it('sends nothing and exits 0 when reporting is turned off', async () => {
    const run = await cli(['sync', 'gherkin', 'features/**/*.feature'], {
      env: { PROBARA_ENABLED: 'false' },
    });

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toContain('nothing was sent');
    expect(fake.requestsTo('gherkinSync')).toHaveLength(0);
  });
});
