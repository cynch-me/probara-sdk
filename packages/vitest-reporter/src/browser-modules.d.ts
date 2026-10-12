/*
 * The browser specifiers of Vitest 3 that the workspace's Vitest (5.x) types do not export (V10): the package of its
 * browser commands, and the suite of its current test. The setup file for Vitest 3 imports them at run time, in the browser.
 */
declare module '@vitest/browser/context' {
  export const commands: unknown;
}

declare module 'vitest/suite' {
  export function getCurrentTest(): unknown;
}
