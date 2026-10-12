/**
 * The browser setup file of Vitest 3 and 4.0 (V10): the browser's commands come from `@vitest/browser/context`, the running
 * test from `vitest/suite` (`TestRunner` does not exist there). The reporter registers it, and Vitest 4.1 and later take
 * `setup-browser.js`.
 */
import { commands } from '@vitest/browser/context';
import { getCurrentTest } from 'vitest/suite';
import { installBrowserSetup } from './browser-setup.js';

installBrowserSetup({
  commands,
  currentTest: () => getCurrentTest(),
});
