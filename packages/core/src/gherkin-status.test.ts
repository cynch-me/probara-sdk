import { describe, expect, it } from 'vitest';
import { cucumberStepStatus, scenarioStatus } from './gherkin-status.js';

describe('cucumberStepStatus', () => {
  it('maps a passed step to passed, in the JSON and the Cucumber Messages spelling', () => {
    expect(cucumberStepStatus('passed')).toBe('passed');
    expect(cucumberStepStatus('PASSED')).toBe('passed');
  });

  it('maps a failed or an ambiguous step to failed, in both spellings', () => {
    for (const status of ['failed', 'FAILED', 'ambiguous', 'AMBIGUOUS']) {
      expect(cucumberStepStatus(status)).toBe('failed');
    }
  });

  it('maps a step that did not run to skipped: skipped, pending, undefined and unknown', () => {
    for (const status of [
      'skipped',
      'pending',
      'undefined',
      'unknown',
      'SKIPPED',
      'PENDING',
      'UNDEFINED',
      'UNKNOWN',
    ]) {
      expect(cucumberStepStatus(status)).toBe('skipped');
    }
  });

  it('maps a missing or unrecognized status to skipped', () => {
    for (const status of [undefined, null, 42, '', 'broken']) {
      expect(cucumberStepStatus(status)).toBe('skipped');
    }
  });
});

describe('scenarioStatus', () => {
  it('passes a scenario whose steps all passed, and a scenario with no steps', () => {
    expect(scenarioStatus(['passed', 'passed'])).toBe('passed');
    expect(scenarioStatus([])).toBe('passed');
  });

  it('is skipped when a step did not run, and failed when a step failed', () => {
    expect(scenarioStatus(['passed', 'skipped'])).toBe('skipped');
    expect(scenarioStatus(['passed', 'failed'])).toBe('failed');
  });

  it('is failed whenever any step failed, whatever the other steps did', () => {
    expect(scenarioStatus(['skipped', 'failed', 'passed'])).toBe('failed');
    expect(scenarioStatus(['failed', 'skipped'])).toBe('failed');
  });
});
