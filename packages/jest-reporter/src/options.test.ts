import { describe, expect, it } from 'vitest';
import { CLIENT_NAME, resolveSetup, type ProbaraJestOptions } from './options.js';

const CONFIGURED = { PROBARA_API_TOKEN: 'prb_test_token', PROBARA_PROJECT: 'PRB' };

function setup(options: ProbaraJestOptions, env: Record<string, string> = CONFIGURED) {
  return resolveSetup({ env, ...options }, '/work/app');
}

describe('resolveSetup', () => {
  it('names the reporter and its version as the client, and roots the files at the given directory', () => {
    const { core } = setup({});
    expect(CLIENT_NAME).toMatch(/^probara-jest-reporter\/\d+\.\d+\.\d+/);
    expect(core.clientName).toBe(CLIENT_NAME);
    expect(core.rootDir).toBe('/work/app');
    expect(setup({ rootDir: '/elsewhere' }).core.rootDir).toBe('/elsewhere');
  });

  it('keys with the file by default, like jest-junit with its file attribute', () => {
    expect(setup({}).keyIncludesFile).toBe(true);
  });

  it('reads keyIncludesFile from PROBARA_KEY_INCLUDES_FILE, and the option over the variable', () => {
    expect(setup({}, { ...CONFIGURED, PROBARA_KEY_INCLUDES_FILE: 'false' }).keyIncludesFile).toBe(
      false,
    );
    expect(
      setup({ keyIncludesFile: true }, { ...CONFIGURED, PROBARA_KEY_INCLUDES_FILE: 'false' })
        .keyIncludesFile,
    ).toBe(true);
    expect(setup({ keyIncludesFile: false }).keyIncludesFile).toBe(false);
  });

  it('turns reporting off on a keyIncludesFile that is not a boolean, naming the option or variable', () => {
    expect(setup({ keyIncludesFile: 'no' as unknown as boolean }).core.adapterProblems).toEqual([
      'keyIncludesFile must be true or false',
    ]);
    expect(
      setup({}, { ...CONFIGURED, PROBARA_KEY_INCLUDES_FILE: 'maybe' }).core.adapterProblems,
    ).toEqual(['PROBARA_KEY_INCLUDES_FILE must be true or false']);
    expect(setup({}).core).not.toHaveProperty('adapterProblems');
  });

  it('captures no output by default, and reads captureOutput like the Playwright reporter', () => {
    expect(setup({}).captureOutput).toBe(false);
    expect(setup({}, { ...CONFIGURED, PROBARA_CAPTURE_OUTPUT: 'true' }).captureOutput).toBe(true);
    expect(
      setup({ captureOutput: false }, { ...CONFIGURED, PROBARA_CAPTURE_OUTPUT: 'true' })
        .captureOutput,
    ).toBe(false);
    expect(setup({ captureOutput: 1 as unknown as boolean }).core.adapterProblems).toEqual([
      'captureOutput must be true or false',
    ]);
    expect(
      setup({}, { ...CONFIGURED, PROBARA_CAPTURE_OUTPUT: 'yes please' }).core.adapterProblems,
    ).toEqual(['PROBARA_CAPTURE_OUTPUT must be true or false']);
    expect(setup({ captureOutput: true }).core).not.toHaveProperty('captureOutput');
  });

  it('warns about each option it does not know, and hands core only its own', () => {
    const result = setup({ projectID: 'WEB', verbose: true } as ProbaraJestOptions);
    expect(result.warnings).toEqual([
      'Ignored the unknown option "projectID" of @probara/jest-reporter',
      'Ignored the unknown option "verbose" of @probara/jest-reporter',
    ]);
    expect(result.core).not.toHaveProperty('projectID');
    expect(result.core).not.toHaveProperty('keyIncludesFile');
    expect(setup({ projectId: 'WEB', debug: false, run: { name: 'Nightly' } }).warnings).toEqual(
      [],
    );
  });

  it('reads the project codes of titles and the status rules of core', () => {
    const result = setup({
      projects: ['WEB'],
      statusMapping: { skipped: 'blocked' },
    });
    expect(result.projectCodes).toEqual(['PRB', 'WEB']);
    expect(result.statusRules?.statusMapping).toEqual({ skipped: 'blocked' });
  });
});
