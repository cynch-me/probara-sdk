/**
 * `probaraSnap` on a real Chromium page, in a real `playwright test`. CI installs no browser for
 * this package, so the suite runs only where Playwright's Chromium is installed
 * (`pnpm exec playwright install chromium`).
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkspace,
  PLAYWRIGHT_DIR,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 180_000;

/** Whether the Chromium of the `@playwright/test` the project runs with is on this machine. */
function chromiumInstalled(): boolean {
  try {
    const require = createRequire(join(PLAYWRIGHT_DIR, 'package.json'));
    const { chromium } = require('@playwright/test') as {
      chromium: { executablePath(): string };
    };
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

describe.skipIf(!chromiumInstalled())('probaraSnap on a real Chromium page', () => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let run: CommandRun;

  beforeAll(async () => {
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace();
    run = await workspace.playwright(
      [
        'test',
        '--config',
        'playwright.snap-browser.config.js',
        '--reporter=line,@probara/playwright-reporter',
      ],
      probaraEnv(fake.baseUrl, { PROBARA_COMMIT: 'a'.repeat(40), PROBARA_BRANCH: 'feat/cart' }),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('holds the page still while it captures, applies the masking and restores the page', () => {
    expect(run.stdout + run.stderr).toContain('1 passed');
    expect(run.exitCode).toBe(0);
  });

  it('sends two PNGs with the browser, the viewport and the color scheme of the page', () => {
    expect(fake.snapBuilds()[0]?.screenshots).toMatchObject([
      {
        name: 'viewport',
        browser: 'chromium',
        viewport: { width: 800, height: 600 },
        colorMode: 'dark',
      },
      { name: 'full', threshold: 0.05, viewport: { width: 800, height: 600 }, colorMode: 'dark' },
    ]);
    const uploads = fake.requestsTo('snapUploadFile').map((request) => request.body);
    expect(uploads).toHaveLength(2);
    for (const upload of uploads) expect(upload).toMatchObject({ type: 'image/png' });
    expect(fake.snapFiles()).toHaveLength(2);
  });
});
