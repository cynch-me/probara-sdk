/**
 * `cy.probaraSnap` in a real `cypress run`: Cypress takes the screenshots of a page, and the plugin uploads them as
 * one Probara Snap build at the end of the run, to a fake Probara that verifies every PNG.
 *
 * The specs of this file live in the fixture project of `test/support/project.ts`; the run is the user's: the built
 * reporter by its package name, the built core, and a fake Probara.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportRequest } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';
import { CYPRESS_DIR, ensureCypressBinaryOnce } from './support/cypress-binary.js';
import {
  createWorkspace,
  outputOf,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const SPEC = 'cypress/e2e/snap.cy.js';
const CYPRESS_VERSION = (
  JSON.parse(readFileSync(join(CYPRESS_DIR, 'package.json'), 'utf8')) as { version: string }
).version;
const TIMEOUT = 300_000;
const COMMIT = 'a'.repeat(40);

beforeAll(() => ensureCypressBinaryOnce());

interface Screenshot {
  name: string;
  sha256: string;
  browser?: string;
  viewport?: { width: number; height: number };
  colorMode?: string;
  threshold?: number;
  test: {
    automationKey: string;
    caseDisplayIds?: string[];
    file: string;
    retry: number;
    retries?: number;
  };
}

function screenshotsOf(fake: FakeProbara): Screenshot[] {
  return (fake.snapBuilds()[0]?.screenshots ?? []) as unknown as Screenshot[];
}

function resultsOf(fake: FakeProbara): ReportRequest['results'] {
  return fake.reports().flatMap((report) => report.results);
}

function keyOf(title: string): string {
  return `${SPEC} > Snap ${title}`;
}

describe('a real cypress run whose specs call cy.probaraSnap', () => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let run: CommandRun;

  beforeAll(async () => {
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace('project', { broken: false, snap: true });
    run = await workspace.cypress(
      ['--browser', 'electron', '--spec', SPEC],
      probaraEnv(fake.baseUrl, { PROBARA_COMMIT: COMMIT, PROBARA_BRANCH: 'feat/cart' }),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('keeps the exit code of the tests and logs the build page, without the token', () => {
    // Two tests fail on purpose: the name used twice, and the one that fails after its screenshot.
    expect(run.exitCode, outputOf(run)).toBe(2);
    expect(run.stdout).toContain(
      `[probara] Sent 7 screenshots to the Snap build #1 (${String(fake.snapFiles().length)} new files): ${fake.baseUrl}/projects/SHOP/snap/${fake.snapBuilds()[0]?.ulid ?? ''}`,
    );
    expect(outputOf(run)).not.toContain(TOKEN);
  });

  it('sends the PNGs Cypress took as one build of the run, with the browser, the viewport and the color scheme', () => {
    expect(fake.snapBuilds()).toMatchObject([
      { commit: COMMIT, branch: 'feat/cart', jobStatus: 'progress', runUlid: fake.runs()[0]?.ulid },
    ]);
    const screenshots = screenshotsOf(fake);
    expect(screenshots.map(({ name, test }) => `${test.automationKey} | ${name}`).sort()).toEqual(
      [
        `${keyOf('fails after its screenshot')} | before-the-failure`,
        `${keyOf('takes its screenshots again on its retry')} | retried`,
        `${keyOf('takes its screenshots again on its retry')} | second-only`,
        `${keyOf('takes the cart')} | cart`,
        `${keyOf('takes the cart')} | cart-whole`,
        `${keyOf('takes the same name in another test')} | cart`,
        `${keyOf('uses a name twice')} | twice`,
      ].sort(),
    );
    for (const screenshot of screenshots) {
      expect(screenshot).toMatchObject({
        browser: 'electron',
        browserVersion: expect.stringMatching(/^\d+\./) as string,
        viewport: { width: 800, height: 600 },
        sdk: { name: '@probara/cypress-reporter', version: VERSION },
        automationLibrary: { name: 'cypress', version: CYPRESS_VERSION },
      });
      // Electron follows the color scheme of the machine the test runs on.
      expect(['light', 'dark']).toContain(screenshot.colorMode);
    }
    expect(
      screenshots
        .map(({ name, test }) => `${name}: ${String(test.retries)}`)
        .filter((entry) => entry.startsWith('retried') || entry.startsWith('cart-whole')),
    ).toEqual(['cart-whole: 0', 'retried: 1']);
    // The fake stores a file only when its bytes are a PNG that hashes to its name; equal pages are one file.
    expect(fake.snapFiles()).toHaveLength(new Set(screenshots.map(({ sha256 }) => sha256)).size);
  });

  it('gives each screenshot the automation key and the cases of its test, as the results have them', () => {
    const keys = new Set(resultsOf(fake).map((result) => result.automationKey));
    for (const screenshot of screenshotsOf(fake)) {
      expect(keys.has(screenshot.test.automationKey)).toBe(true);
      expect(screenshot.test.file).toBe(SPEC);
    }
    const cart = screenshotsOf(fake).find(
      ({ name, test }) => name === 'cart' && test.automationKey === keyOf('takes the cart'),
    );
    expect(cart?.test).toMatchObject({ caseDisplayIds: ['SHOP-7'], retry: 0 });
  });

  it('masks and hides what the options name, takes the whole page on demand, and leaves the page as it was', () => {
    // The test itself asserts that the page holds no style of the capture afterwards.
    const [taken] = resultsOf(fake).filter(
      (result) => result.automationKey === keyOf('takes the cart'),
    );
    expect(taken?.status).toBe('passed');
    const whole = screenshotsOf(fake).find(({ name }) => name === 'cart-whole');
    const viewport = screenshotsOf(fake).find(
      ({ name, test }) => name === 'cart' && test.automationKey === keyOf('takes the cart'),
    );
    expect(whole?.threshold).toBe(0.1);
    expect(whole?.sha256).not.toBe(viewport?.sha256);
    // The same name in another test, of a page without its banner: a screenshot of its own.
    const other = screenshotsOf(fake).find(
      ({ test }) => test.automationKey === keyOf('takes the same name in another test'),
    );
    expect(other?.sha256).not.toBe(viewport?.sha256);
  });

  it('sends the screenshots of the last attempt of a retried test', () => {
    const retried = screenshotsOf(fake).filter(
      ({ test }) => test.automationKey === keyOf('takes its screenshots again on its retry'),
    );
    expect(retried.map(({ name, test }) => [name, test.retry])).toEqual([
      ['retried', 1],
      ['second-only', 1],
    ]);
  });

  it('fails the test that uses a name twice, with the rule in its error', () => {
    const [twice] = resultsOf(fake).filter(
      (result) => result.automationKey === keyOf('uses a name twice'),
    );
    expect(twice?.status).toBe('failed');
    expect(twice?.notes).toContain(
      'probaraSnap(): the name "twice" is already used in this test: screenshot names must be unique within a test',
    );
  });

  it('keeps the screenshots out of the result attachments, and the failure screenshots in them', () => {
    const staged = fake.stagedFiles();
    const snapped = new Set(screenshotsOf(fake).map((screenshot) => screenshot.sha256));
    expect(staged.filter((file) => snapped.has(file.sha256))).toEqual([]);
    expect(staged.filter((file) => file.type.includes('probara.snap'))).toEqual([]);
    // One per failed attempt: the name used twice, the first attempt of the retried test, and the failure.
    expect(staged.filter((file) => file.type === 'image/png')).toHaveLength(3);
  });
});
