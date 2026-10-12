/**
 * The browser setup file of Vitest 4.1 and later, and of Vitest 5 (V10): the browser's commands come from `vitest/browser`,
 * the running test from `TestRunner`. The reporter registers it in each browser project of these majors; Vitest 3 and 4.0
 * take `setup-browser-v3.js` (V10 decides which by the Vitest version).
 */
import { TestRunner } from 'vitest';
import { commands } from 'vitest/browser';
import { installBrowserSetup } from './browser-setup.js';

installBrowserSetup({
  commands,
  currentTest: () => TestRunner.getCurrentTest(),
});
