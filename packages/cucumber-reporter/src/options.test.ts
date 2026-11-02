import { describe, expect, it } from 'vitest';
import { CLIENT_NAME, resolveSetup, type ProbaraCucumberOptions } from './options.js';
import { VERSION } from './version.js';

describe('CLIENT_NAME', () => {
  it('names the formatter and its version in the User-Agent', () => {
    expect(CLIENT_NAME).toBe(`probara-cucumber-reporter/${VERSION}`);
  });
});

describe('resolveSetup', () => {
  it('reads the project of a configuration from its PROBARA_* variable when the options leave it out', () => {
    const setup = resolveSetup(
      { env: { PROBARA_PROJECT: 'SHOP', PROBARA_API_TOKEN: 'prb_test_T0KEN' } },
      '/work/shop',
    );
    expect(setup.projectCodes).toEqual(['SHOP']);
    expect(setup.core.clientName).toBe(CLIENT_NAME);
  });

  it('gives an option over its variable', () => {
    const setup = resolveSetup(
      { projectId: 'WEB', env: { PROBARA_PROJECT: 'SHOP', PROBARA_API_TOKEN: 'prb_test_T0KEN' } },
      '/work/shop',
    );
    expect(setup.projectCodes).toEqual(['WEB']);
  });

  it('roots the feature paths at the working directory, unless rootDir is set', () => {
    expect(resolveSetup({}, '/work/shop').core.rootDir).toBe('/work/shop');
    expect(resolveSetup({ rootDir: '/work' }, '/work/shop').core.rootDir).toBe('/work');
  });

  it('warns about each option it does not know, in order, and keeps the ones it takes', () => {
    const setup = resolveSetup(
      {
        projectId: 'SHOP',
        projectID: 'WEB',
        verbose: true,
        env: { PROBARA_API_TOKEN: 'prb_test_T0KEN' },
      } as unknown as ProbaraCucumberOptions,
      '/work/shop',
    );
    expect(setup.warnings).toEqual([
      'Ignored the unknown option "projectID" of @probara/cucumber-reporter',
      'Ignored the unknown option "verbose" of @probara/cucumber-reporter',
    ]);
    expect(setup.projectCodes).toEqual(['SHOP']);
  });

  it('warns about nothing when every option is one the formatter takes', () => {
    expect(resolveSetup({ projectId: 'SHOP', rootDir: '/work' }, '/work/shop').warnings).toEqual(
      [],
    );
  });
});
