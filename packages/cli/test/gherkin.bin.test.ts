/**
 * The built bin (`dist/cli.js`) runs `sync gherkin` and `import cucumber` against the fake Probara,
 * the way a CI job does. The key `import cucumber` builds for a scenario equals the key
 * `sync gherkin` sends for it: that is what links the results to the synced cases. `globalSetup`
 * builds the bin.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixturePath } from './fixtures.js';
import { TOKEN } from './support/run-cli.js';

const BIN = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const SOURCE = fixturePath('cucumber', 'source');
const REPORT = fixturePath('cucumber', 'cucumber.json');
const OUTLINE_KEY = 'features/checkout/pay.feature > Checkout > Pay with <method>';
const run = promisify(execFile);

let fake: FakeProbara;
let dir: string;
beforeEach(async () => {
  fake = await startFakeProbara({ token: TOKEN });
  dir = await mkdtemp(join(tmpdir(), 'probara-gherkin-bin-'));
});
afterEach(async () => {
  await fake.close();
  await rm(dir, { recursive: true, force: true });
});

async function bin(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  const env = {
    PATH: process.env['PATH'] ?? '',
    PROBARA_API_TOKEN: TOKEN,
    PROBARA_PROJECT: 'PRB',
    PROBARA_BASE_URL: fake.baseUrl,
    ...opts.env,
  };
  try {
    const out = await run(process.execPath, [BIN, ...args], { cwd: opts.cwd ?? SOURCE, env });
    return { code: 0, stdout: out.stdout, stderr: out.stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

/** The link of the first scenario of the `index`-th sync the fake received. */
function firstScenarioUrl(index: number): string | undefined {
  return fake.gherkinSyncs()[index]?.features[0]?.scenarios[0]?.url;
}

describe('the built bin syncs feature files and imports Cucumber results', () => {
  it('builds the same key for a scenario in both commands, an outline with its row values', async () => {
    const sync = await bin(['sync', 'gherkin', 'features/**/*.feature']);
    expect(sync.code, sync.stderr).toBe(0);
    const syncKeys = new Set(
      fake
        .gherkinSyncs()
        .flatMap((body) => body.features)
        .flatMap((feature) => feature.scenarios.map((scenario) => scenario.automationKey)),
    );
    expect(syncKeys.has(OUTLINE_KEY)).toBe(true);

    const imported = await bin(['import', 'cucumber', REPORT, '--run-name', 'Cucumber']);
    expect(imported.code, imported.stderr).toBe(0);
    const results = fake.reports().flatMap((report) => report.results);
    expect(results).toHaveLength(10);
    expect(results.filter((result) => !syncKeys.has(result.automationKey ?? ''))).toEqual([]);
    expect(
      results
        .filter((result) => result.automationKey === OUTLINE_KEY)
        .map((result) => result.parameters),
    ).toEqual([
      { method: 'visa', amount: '12' },
      { method: 'paypal', amount: '30' },
    ]);
  });

  it('sends dryRun on a dry run, and nothing with PROBARA_ENABLED=false', async () => {
    const dry = await bin(['sync', 'gherkin', 'features/**/*.feature', '--dry-run']);
    expect(dry.code, dry.stderr).toBe(0);
    expect(fake.gherkinSyncs()[0]?.dryRun).toBe(true);

    const off = await bin(['sync', 'gherkin', 'features/**/*.feature'], {
      env: { PROBARA_ENABLED: 'false' },
    });
    expect(off.code).toBe(0);
    expect(fake.gherkinSyncs()).toHaveLength(1);
  });

  it('exits 2 and sends nothing for non-English keywords or two scenarios of one name', async () => {
    await mkdir(join(dir, 'features'), { recursive: true });
    await writeFile(
      join(dir, 'features', 'es.feature'),
      '# language: es\nCaracterística: Pago\n  Escenario: Pagar\n    Dado un carrito\n',
    );
    const spanish = await bin(['sync', 'gherkin', 'features/es.feature'], { cwd: dir });
    expect(spanish.code).toBe(2);

    await writeFile(
      join(dir, 'features', 'dup.feature'),
      'Feature: Pay\n  Scenario: Same\n    Given a\n\n  Scenario: Same\n    Given b\n',
    );
    const duplicate = await bin(['sync', 'gherkin', 'features/dup.feature'], { cwd: dir });
    expect(duplicate.code).toBe(2);
    expect(duplicate.stderr).toContain('features/dup.feature:2');
    expect(duplicate.stderr).toContain('features/dup.feature:5');
    expect(fake.gherkinSyncs()).toHaveLength(0);
  });

  it('links each scenario from --file-url or the GitHub Actions environment', async () => {
    const template = await bin([
      'sync',
      'gherkin',
      'features/cart/cart.feature',
      '--file-url',
      'https://git.example.com/r/{path}?l={line}',
    ]);
    expect(template.code, template.stderr).toBe(0);
    expect(firstScenarioUrl(0)).toBe('https://git.example.com/r/features/cart/cart.feature?l=6');

    const github = await bin(['sync', 'gherkin', 'features/cart/cart.feature'], {
      env: {
        GITHUB_ACTIONS: 'true',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'acme/shop',
        GITHUB_SHA: 'abc123',
      },
    });
    expect(github.code, github.stderr).toBe(0);
    expect(firstScenarioUrl(1)).toBe(
      'https://github.com/acme/shop/blob/abc123/features/cart/cart.feature#L6',
    );
  });
});
