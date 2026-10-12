import { createReporter } from '@probara/core';
import { describe, expect, it } from 'vitest';
import { CLIENT_NAME, resolveSetup, type ProbaraVitestOptions } from './options.js';

/** A sink that records each line with the channel it went to. */
function recorder() {
  const lines: { channel: 'warn' | 'error'; message: string }[] = [];
  return {
    lines,
    sink: {
      warn: (message: string) => lines.push({ channel: 'warn', message }),
      error: (message: string) => lines.push({ channel: 'error', message }),
    },
  };
}

function setupOf(options: ProbaraVitestOptions, env: Record<string, string> = {}) {
  const { lines, sink } = recorder();
  const setup = resolveSetup({ env, ...options }, { rootDir: '/work/shop', sink });
  return { setup, lines };
}

describe('resolveSetup', () => {
  it('names the reporter and its version as the client, and roots the files at the framework root', () => {
    const { setup } = setupOf({});
    expect(setup.core.clientName).toBe(CLIENT_NAME);
    expect(CLIENT_NAME).toMatch(/^probara-vitest-reporter\/\d+\.\d+\.\d+/);
    expect(setup.core.rootDir).toBe('/work/shop');
  });

  it('keys with the file by default, and reads keyIncludesFile from the variable, the option winning', () => {
    expect(setupOf({}).setup.keyIncludesFile).toBe(true);
    expect(setupOf({}, { PROBARA_KEY_INCLUDES_FILE: 'false' }).setup.keyIncludesFile).toBe(false);
    expect(
      setupOf({ keyIncludesFile: true }, { PROBARA_KEY_INCLUDES_FILE: 'false' }).setup
        .keyIncludesFile,
    ).toBe(true);
  });

  it('turns reporting off on a keyIncludesFile that is not a boolean, with an error naming the variable', () => {
    // Core stays silent for an unconfigured reporter, so the setting is checked on a configured one.
    const configured = { PROBARA_API_TOKEN: 'prb_test_TOKEN', PROBARA_PROJECT: 'SHOP' };
    const { setup, lines } = setupOf({}, { ...configured, PROBARA_KEY_INCLUDES_FILE: 'maybe' });
    expect(createReporter(setup.core).enabled).toBe(false);
    const errors = lines.filter((line) => line.channel === 'error').map((line) => line.message);
    expect(errors.join('\n')).toContain('PROBARA_KEY_INCLUDES_FILE');
  });

  it('captures no output and keeps screenshots by default, and reads both from their variables', () => {
    const defaults = setupOf({}).setup;
    expect(defaults.captureOutput).toBe(false);
    expect(defaults.attachScreenshots).toBe(true);
    const set = setupOf(
      {},
      { PROBARA_CAPTURE_OUTPUT: 'true', PROBARA_ATTACH_SCREENSHOTS: 'false' },
    ).setup;
    expect(set.captureOutput).toBe(true);
    expect(set.attachScreenshots).toBe(false);
  });

  it('reads issueUrlTemplate from the option, else its variable, and none by default', () => {
    expect(setupOf({}).setup.issueUrlTemplate).toBeUndefined();
    expect(
      setupOf({}, { PROBARA_ISSUE_URL_TEMPLATE: 'https://jira.example.com/browse/%s' }).setup
        .issueUrlTemplate,
    ).toBe('https://jira.example.com/browse/%s');
  });

  it('runs every test by default, and reads runCasesOnly from its variable', () => {
    expect(setupOf({}).setup.runCasesOnly).toBe(false);
    expect(setupOf({}, { PROBARA_RUN_CASES_ONLY: 'true' }).setup.runCasesOnly).toBe(true);
  });

  it('warns about each option it does not know, and hands core only its own', () => {
    const { setup } = setupOf({ projectId: 'SHOP', nonsense: true } as ProbaraVitestOptions);
    expect(setup.core.projectId).toBe('SHOP');
    expect(Object.keys(setup.core)).not.toContain('nonsense');
    expect(setup.warnings).toEqual([
      'Ignored the unknown option "nonsense" of @probara/vitest-reporter',
    ]);
  });
});
