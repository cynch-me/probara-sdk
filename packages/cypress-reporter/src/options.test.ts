import { describe, expect, it } from 'vitest';
import { CLIENT_NAME, resolveSetup, type ProbaraCypressOptions } from './options.js';

const CONFIGURED = { PROBARA_API_TOKEN: 'prb_test_token', PROBARA_PROJECT: 'PRB' };

function setup(options: ProbaraCypressOptions, env: Record<string, string> = CONFIGURED) {
  return resolveSetup({ env, ...options }, '/work/app');
}

/** Every boolean setting of the reporter, with its variable, its default and the other value. */
const BOOLEANS = [
  { option: 'keyIncludesFile', variable: 'PROBARA_KEY_INCLUDES_FILE', fallback: true },
  { option: 'captureOutput', variable: 'PROBARA_CAPTURE_OUTPUT', fallback: false },
  { option: 'attachScreenshots', variable: 'PROBARA_ATTACH_SCREENSHOTS', fallback: true },
  { option: 'attachVideos', variable: 'PROBARA_ATTACH_VIDEOS', fallback: false },
  { option: 'browserAsParameter', variable: 'PROBARA_BROWSER_AS_PARAMETER', fallback: true },
  { option: 'runCasesOnly', variable: 'PROBARA_RUN_CASES_ONLY', fallback: false },
] as const;

describe('resolveSetup', () => {
  it('names the reporter and its version as the client, and roots the files at the given directory', () => {
    const { core } = setup({});
    expect(CLIENT_NAME).toMatch(/^probara-cypress-reporter\/\d+\.\d+\.\d+$/);
    expect(core.clientName).toBe(CLIENT_NAME);
    expect(core.rootDir).toBe('/work/app');
    expect(setup({ rootDir: '/elsewhere' }).core.rootDir).toBe('/elsewhere');
  });

  it('gives every setting of the reporter its documented default', () => {
    const resolved = setup({});
    expect(resolved).toMatchObject(
      Object.fromEntries(BOOLEANS.map(({ option, fallback }) => [option, fallback])),
    );
    expect(resolved.issueUrlTemplate).toBeUndefined();
    expect(resolved.warnings).toEqual([]);
  });

  it.each(BOOLEANS)('reads $option from its variable, and the option over it', (setting) => {
    const other = !setting.fallback;
    expect(setup({}, { ...CONFIGURED, [setting.variable]: String(other) })[setting.option]).toBe(
      other,
    );
    expect(
      setup(
        { [setting.option]: setting.fallback },
        { ...CONFIGURED, [setting.variable]: String(other) },
      )[setting.option],
    ).toBe(setting.fallback);
  });

  it.each(BOOLEANS)('turns reporting off on a $option that is not a boolean', (setting) => {
    expect(setup({ [setting.option]: 'no' as unknown as boolean }).core.adapterProblems).toEqual([
      `${setting.option} must be true or false`,
    ]);
    expect(setup({}, { ...CONFIGURED, [setting.variable]: 'maybe' }).core.adapterProblems).toEqual([
      `${setting.variable} must be true or false`,
    ]);
  });

  it('reads issueUrlTemplate from the option, else PROBARA_ISSUE_URL_TEMPLATE, and checks it', () => {
    expect(setup({}).issueUrlTemplate).toBeUndefined();
    expect(
      setup({}, { ...CONFIGURED, PROBARA_ISSUE_URL_TEMPLATE: 'https://jira.example.com/browse/%s' })
        .issueUrlTemplate,
    ).toBe('https://jira.example.com/browse/%s');
    expect(
      setup({ issueUrlTemplate: ' https://github.com/shop/app/issues/%s ' }).issueUrlTemplate,
    ).toBe('https://github.com/shop/app/issues/%s');
    expect(
      setup({ issueUrlTemplate: 'https://jira.example.com/browse/PRB-7' }).core.adapterProblems,
    ).toEqual(['issueUrlTemplate must be an http(s) URL with %s where the issue id goes']);
  });

  it('leaves an option of core or of the reporter out of the core options, and warns about an unknown one', () => {
    const setupOf = setup({ attachVideos: true, browserAsParameter: false, rootDir: '/work/app' });
    expect(setupOf.core).not.toHaveProperty('attachVideos');
    expect(setupOf.core).not.toHaveProperty('browserAsParameter');
    expect(setupOf.core.rootDir).toBe('/work/app');
    expect(setup({ captureOutput: true, projectId: 'SHOP' }).warnings).toEqual([]);
    expect(setup({ caputureOutput: true } as unknown as ProbaraCypressOptions).warnings).toEqual([
      'Ignored the unknown option "caputureOutput" of @probara/cypress-reporter',
    ]);
  });

  it('logs nothing itself: the problems of the options are returned to the caller', () => {
    expect(setup({ captureOutput: 'no' as unknown as boolean }).core.logger).toBeDefined();
  });
});
