/**
 * The one reading of the user's reporter options, over every shape the two processes of a run are
 * handed: the reporter process reads what Cypress (or `cypress-multi-reporters`) gives a reporter,
 * the plugin reads `config.reporterOptions`, which is the plain object or the configuration of
 * `cypress-multi-reporters`.
 */
import { describe, expect, it } from 'vitest';
import { MULTI_REPORTERS_KEY, probaraOptionsOf, reporterOptionsOf } from './reporter-options.js';

const OPTIONS = { projectId: 'SHOP', attachVideos: true };

/** The `reporterOptions` of a config that registers this reporter through cypress-multi-reporters. */
const MULTI = {
  reporterEnabled: 'spec, @probara/cypress-reporter',
  probaraCypressReporterReporterOptions: OPTIONS,
};

describe('probaraOptionsOf, what the plugin reads', () => {
  it('returns the plain object of the config as it is', () => {
    expect(probaraOptionsOf(OPTIONS)).toBe(OPTIONS);
  });

  it('reads the options cypress-multi-reporters gives this reporter: camelCase(name) + ReporterOptions', () => {
    // cypress-multi-reporters 2.0.5 (`getReporterOptions`): `_.camelCase(name) + 'ReporterOptions'`.
    expect(MULTI_REPORTERS_KEY).toBe('probaraCypressReporterReporterOptions');
    expect(probaraOptionsOf(MULTI)).toEqual(OPTIONS);
  });

  it('merges the common reporterOptions of cypress-multi-reporters under ours, as it does', () => {
    const multi = { ...MULTI, reporterOptions: { attachVideos: false, debug: true } };
    expect(probaraOptionsOf(multi)).toEqual({ ...OPTIONS, debug: true });
  });

  it('reads no options of ours from a cypress-multi-reporters config that sets none', () => {
    // Its own keys (`reporterEnabled`, another reporter's options) are never options of this one.
    const multi = {
      reporterEnabled: 'spec, @probara/cypress-reporter',
      mochaJunitReporterReporterOptions: { mochaFile: 'junit.xml' },
    };
    expect(probaraOptionsOf(multi)).toEqual({});
  });

  it('passes anything that is not an object through, for the caller to read', () => {
    for (const value of [undefined, null, 42, 'a string', true]) {
      expect(probaraOptionsOf(value)).toBe(value);
    }
  });
});

describe('reporterOptionsOf, what Cypress hands the reporter', () => {
  it('reads the reporterOptions of the envelope Cypress builds', () => {
    expect(reporterOptionsOf({ reporterOptions: OPTIONS })).toBe(OPTIONS);
  });

  it('reads the options themselves when there is no envelope', () => {
    expect(reporterOptionsOf(OPTIONS)).toBe(OPTIONS);
  });

  it('passes anything that is not an object through, for the caller to read', () => {
    for (const value of [undefined, null, 42, 'a string']) {
      expect(reporterOptionsOf(value)).toBe(value);
    }
    expect(reporterOptionsOf({ reporterOptions: null })).toBe(null);
  });
});

describe('the two readings agree', () => {
  it('give the same options for what one config produces', () => {
    // Plain: Cypress hands the reporter `{ reporterOptions }` and the plugin the same object.
    expect(reporterOptionsOf({ reporterOptions: OPTIONS })).toEqual(probaraOptionsOf(OPTIONS));
    // cypress-multi-reporters hands the reporter `{ reporterOptions: <ours, merged> }` while the
    // plugin is handed its whole configuration.
    const multi = { ...MULTI, reporterOptions: { debug: true } };
    const handed = { reporterOptions: { debug: true, ...OPTIONS } };
    expect(reporterOptionsOf(handed)).toEqual(probaraOptionsOf(multi));
  });
});
