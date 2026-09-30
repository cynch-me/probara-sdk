/**
 * `@probara/jest-reporter/setup`, for `setupFilesAfterEnv` in the Jest config:
 * `setupFilesAfterEnv: ['@probara/jest-reporter/setup']`. It turns on what the reporter can only
 * do from inside each test file: `runCasesOnly` (runs only the tests of a run's cases) and
 * `captureOutput` (each test's console output). Without the reporter
 * (or with those options off) it does nothing.
 *
 * Jest loads it in every test file's sandbox: it loads Node built-ins and a few files of this
 * package, never the reporter nor the reporting library.
 */
import { CHANNEL_VARIABLE } from './channel.js';
import { installSetup, type SelectionModule, type SetupHooks } from './setup-hooks.js';

/** Jest's root hooks, from the globals of the sandbox; none outside Jest. */
function jestHooks(): SetupHooks | undefined {
  const { beforeAll, beforeEach, afterEach } = globalThis as unknown as Partial<SetupHooks>;
  if (typeof beforeEach !== 'function' || typeof afterEach !== 'function') return undefined;
  return { beforeEach, afterEach, ...(typeof beforeAll === 'function' ? { beforeAll } : {}) };
}

installSetup({
  global: globalThis,
  hooks: jestHooks(),
  channel: () => {
    const dir = process.env[CHANNEL_VARIABLE];
    return dir === undefined || dir === '' ? undefined : dir;
  },
  // Loaded only with runCasesOnly: without it, the setup file loads nothing of the reporting library.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only when needed.
  selection: () => require('./selection.js') as SelectionModule,
});
