import { describe, expect, it } from 'vitest';
import { resolveSnapSettings, snapNonceOf } from './snap-settings.js';

describe('resolveSnapSettings', () => {
  it('reads the options, else their variables, trimmed', () => {
    expect(
      resolveSnapSettings(
        { snap: true, snapBuildName: ' mobile ', snapNonce: 'nightly-7' },
        { PROBARA_SNAP: 'false', PROBARA_SNAP_BUILD_NAME: 'desktop', PROBARA_SNAP_NONCE: 'other' },
      ),
    ).toEqual({ snap: true, buildName: 'mobile', nonce: 'nightly-7', problems: [] });
    expect(
      resolveSnapSettings(
        {},
        { PROBARA_SNAP: 'true', PROBARA_SNAP_BUILD_NAME: 'desktop', PROBARA_SNAP_NONCE: ' n-8 ' },
      ),
    ).toEqual({ snap: true, buildName: 'desktop', nonce: 'n-8', problems: [] });
    expect(resolveSnapSettings({}, {})).toEqual({ snap: false, problems: [] });
  });

  it('names the options of a wrong type', () => {
    expect(
      resolveSnapSettings({ snap: 'yes', snapBuildName: 7, snapNonce: 8 }, {}).problems,
    ).toEqual([
      'snap must be true or false',
      'snapBuildName must be a string',
      'snapNonce must be a string',
    ]);
  });
});

describe('snapNonceOf', () => {
  const env = { GITLAB_CI: 'true', CI_PIPELINE_ID: '4521' };

  it('is the nonce that was set, else what the CI gives', () => {
    expect(snapNonceOf('mine', env)).toBe('mine');
    expect(snapNonceOf(undefined, env)).toBe('4521');
    expect(snapNonceOf(undefined, {})).toBeUndefined();
  });
});
