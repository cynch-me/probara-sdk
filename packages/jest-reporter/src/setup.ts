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
import { installSetup, jestHooksOf, type SelectionModule } from './setup-hooks.js';

installSetup({
  global: globalThis,
  // Without Jest's globals (injectGlobals: false), Jest answers `@jest/globals` in any test file.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest's own module, loaded only then.
  hooks: jestHooksOf(globalThis, () => require('@jest/globals') as unknown),
  channel: () => {
    const dir = process.env[CHANNEL_VARIABLE];
    return dir === undefined || dir === '' ? undefined : dir;
  },
  // Loaded only with runCasesOnly: without it, the setup file loads nothing of the reporting library.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only when needed.
  selection: () => require('./selection.js') as SelectionModule,
});
