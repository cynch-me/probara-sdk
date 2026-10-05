/**
 * The one reading of the user's reporter options, over every shape the two processes of a run are
 * handed: the reporter process reads what Cypress gives a reporter, the plugin reads
 * `config.reporterOptions`, and both may be the plain object or a multi-reporter's wrapper.
 */
import { describe, expect, it } from 'vitest';
import { probaraOptionsOf, reporterOptionsOf } from './reporter-options.js';

const OPTIONS = { projectId: 'SHOP', attachVideos: true };

describe('probaraOptionsOf, what the plugin reads', () => {
  it('returns the plain object of the config as it is', () => {
    expect(probaraOptionsOf(OPTIONS)).toBe(OPTIONS);
  });

  it('unwraps the wrapper a multi-reporter builds: one key, this package, the options inside', () => {
    const wrapper = { '@probara/cypress-reporter': OPTIONS };
    expect(probaraOptionsOf(wrapper)).toBe(OPTIONS);
  });

  it('leaves a wrapper of another reporter as it is', () => {
    // One key that is not ours is another reporter's: unwrapping it would read its options as ours.
    const other = { 'mocha-junit-reporter': { mochaFile: 'junit.xml' } };
    expect(probaraOptionsOf(other)).toBe(other);
    // And more than one key is never a wrapper of this package.
    const two = { '@probara/cypress-reporter': OPTIONS, mochaFile: 'junit.xml' };
    expect(probaraOptionsOf(two)).toBe(two);
  });

  it('passes anything that is not an object through, for the caller to read', () => {
    for (const value of [undefined, null, 42, 'a string', true]) {
      expect(probaraOptionsOf(value)).toBe(value);
    }
  });

  it('unwraps a wrapper whose value is not an object, as far as it can', () => {
    expect(probaraOptionsOf({ '@probara/cypress-reporter': null })).toBe(null);
  });
});

describe('reporterOptionsOf, what Cypress hands the reporter', () => {
  it('reads the reporterOptions of the envelope Cypress builds', () => {
    expect(reporterOptionsOf({ reporterOptions: OPTIONS })).toBe(OPTIONS);
  });

  it('unwraps the wrapper inside the envelope', () => {
    const options = { reporterOptions: { '@probara/cypress-reporter': OPTIONS } };
    expect(reporterOptionsOf(options)).toBe(OPTIONS);
  });

  it('reads the options themselves when there is no envelope', () => {
    expect(reporterOptionsOf(OPTIONS)).toBe(OPTIONS);
    expect(reporterOptionsOf({ '@probara/cypress-reporter': OPTIONS })).toBe(OPTIONS);
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
    // The two processes are handed two shapes of one object; the wrapper is what makes them differ.
    for (const given of [
      OPTIONS,
      { '@probara/cypress-reporter': OPTIONS },
      { 'mocha-junit-reporter': OPTIONS },
    ]) {
      expect(reporterOptionsOf({ reporterOptions: given })).toBe(probaraOptionsOf(given));
    }
  });
});
