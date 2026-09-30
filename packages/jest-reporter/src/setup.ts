/**
 * `@probara/jest-reporter/setup`, for `setupFilesAfterEnv` in the Jest config:
 * `setupFilesAfterEnv: ['@probara/jest-reporter/setup']`. It turns on what the reporter can only
 * do from inside each test file: `captureOutput` (each test's console output). Without the reporter
 * (or with those options off) it does nothing.
 *
 * Jest loads it in every test file's sandbox: it loads Node built-ins and a few files of this
 * package, never the reporter nor the reporting library.
 */
import { CHANNEL_VARIABLE } from './channel.js';
import { installSetup, type SetupHooks } from './setup-hooks.js';

/** Jest's root hooks, from the globals of the sandbox; none outside Jest. */
function jestHooks(): SetupHooks | undefined {
  const { beforeEach, afterEach } = globalThis as unknown as Partial<SetupHooks>;
  return typeof beforeEach === 'function' && typeof afterEach === 'function'
    ? { beforeEach, afterEach }
    : undefined;
}

installSetup({
  global: globalThis,
  hooks: jestHooks(),
  channel: () => {
    const dir = process.env[CHANNEL_VARIABLE];
    return dir === undefined || dir === '' ? undefined : dir;
  },
});
