/**
 * `@probara/cypress-reporter/support`: the browser side of a Cypress run. One line in the Cypress
 * support file turns it on:
 *
 * ```js
 * require('@probara/cypress-reporter/support'); // or: import '@probara/cypress-reporter/support'
 * ```
 *
 * It publishes the `probara.*` helpers (the set `@probara/jest-reporter` has) on the global of the
 * spec frame, wraps the browser console when the reporter's `captureOutput` is on, and skips the
 * tests the run's cases do not take when `runCasesOnly` is on. Without the plugin
 * (`setupNodeEvents`) every helper does nothing, and one line on the console says why.
 *
 * It loads **no Node built-in**: a support file runs in the browser, where `node:fs` does not
 * exist. Everything here is pure, and reaches `@probara/core/browser` (`support-api.ts`), never the
 * reporting library.
 */
import {
  createProbara,
  identityOf,
  installOutputCapture,
  installSelection,
  installSupport,
  isSelected,
  readSettings,
  uuidOf,
  type BrowserConsole,
  type CypressBrowser,
  type CypressChain,
  type Probara,
  type SupportContext,
  type SupportHooks,
} from './support-api.js';

export type {
  BrowserConsole,
  CypressBrowser,
  CypressChain,
  Probara,
  ProbaraAttachment,
  ProbaraStepOptions,
  ProbaraValues,
  SupportContext,
  SupportHooks,
} from './support-api.js';

/**
 * The browser a Cypress spec runs in, as it is: the globals of the spec frame. `undefined` for
 * anything of them a frame does not have, and every helper of this package stays a no-op then.
 */
export function browserContext(): SupportContext {
  const frame = globalThis as unknown as {
    Cypress?: CypressBrowser;
    cy?: CypressChain;
    before?: (fn: () => void) => void;
    beforeEach?: (fn: () => void) => void;
    afterEach?: (fn: () => void) => void;
    console?: BrowserConsole;
    probara?: Probara;
  };
  return {
    cypress: () => frame.Cypress,
    cy: () => frame.cy,
    hooks: () => {
      const { before, beforeEach, afterEach } = frame;
      if (
        typeof before !== 'function' ||
        typeof beforeEach !== 'function' ||
        typeof afterEach !== 'function'
      )
        return undefined;
      return { before, beforeEach, afterEach } satisfies SupportHooks;
    },
    console: () => frame.console,
    warn: (message) => {
      frame.console?.warn?.(`[probara] ${message}`);
    },
    now: () => Date.now(),
    uuid: () => uuidOf(),
    publish: (probara) => {
      frame.probara = probara;
    },
  };
}

// Nothing of it throws into a Cypress test, whatever the frame is: without a Cypress there is no
// browser side to set up, and with one the helpers are published whatever they can report.
installSupport(browserContext());

export {
  createProbara,
  identityOf,
  installOutputCapture,
  installSelection,
  installSupport,
  isSelected,
  readSettings,
};
