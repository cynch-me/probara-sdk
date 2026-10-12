/**
 * `@probara/vitest-reporter`: the default export is the reporter class Vitest instantiates with the
 * options of the config entry (`reporters: ['default', ['@probara/vitest-reporter', options]]`), and
 * `probara` is the helpers of the running test.
 */
export { default } from './reporter.js';
export { CLIENT_NAME, type ProbaraVitestOptions } from './options.js';
export {
  probara,
  type Probara,
  type ProbaraAttachment,
  type ProbaraStepOptions,
  type ProbaraValues,
} from './probara.js';
