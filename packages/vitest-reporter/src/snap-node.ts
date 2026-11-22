/**
 * `probaraSnap` for a test that runs in Node: the same export as the browser's, so a test file shared by a Node
 * project and a browser project imports one name. Node has no page to capture: it checks its arguments, says so
 * once, and takes nothing.
 */
import { createProbaraSnap } from './browser-snap.js';

export type { ProbaraSnapOptions } from '@probara/core/browser';

/**
 * Takes a screenshot of the test's page for Probara Snap, in browser mode (see the browser entry of this
 * package). In a Node project it captures nothing, with one warning.
 */
export const probaraSnap = createProbaraSnap({
  current: () => undefined,
  page: () => undefined,
  document: () => undefined,
  attach: () => Promise.resolve(),
  warn: (message) => {
    console.warn(`[probara] ${message}`);
  },
});
