import { describe, expect, it } from 'vitest';
import { fileUrlOf, fileUrlTemplateOf } from './file-url.js';

const GITHUB = {
  GITHUB_ACTIONS: 'true',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'acme/shop',
  GITHUB_SHA: 'abc123',
};

describe('fileUrlTemplateOf', () => {
  it('is the --file-url template when one is given, even inside a CI', () => {
    expect(fileUrlTemplateOf('https://git.example.test/{path}#L{line}', GITHUB)).toBe(
      'https://git.example.test/{path}#L{line}',
    );
  });

  it('derives the GitHub Actions template from the CI environment', () => {
    expect(fileUrlTemplateOf(undefined, GITHUB)).toBe(
      'https://github.com/acme/shop/blob/abc123/{path}#L{line}',
    );
  });

  it('derives the GitLab template from the CI environment', () => {
    expect(
      fileUrlTemplateOf(undefined, {
        GITLAB_CI: 'true',
        CI_PROJECT_URL: 'https://gitlab.example.test/acme/shop',
        CI_COMMIT_SHA: 'abc123',
      }),
    ).toBe('https://gitlab.example.test/acme/shop/-/blob/abc123/{path}#L{line}');
  });

  it('derives the Bitbucket template from the CI environment', () => {
    expect(
      fileUrlTemplateOf(undefined, {
        BITBUCKET_BUILD_NUMBER: '7',
        BITBUCKET_REPO_FULL_NAME: 'acme/shop',
        BITBUCKET_COMMIT: 'abc123',
      }),
    ).toBe('https://bitbucket.org/acme/shop/src/abc123/{path}#lines-{line}');
  });

  it('derives the Azure DevOps template, with the project name encoded', () => {
    expect(
      fileUrlTemplateOf(undefined, {
        TF_BUILD: 'True',
        SYSTEM_COLLECTIONURI: 'https://dev.azure.test/acme/',
        SYSTEM_TEAMPROJECT: 'Shop Team',
        BUILD_REPOSITORY_NAME: 'shop',
        BUILD_SOURCEVERSION: 'abc123',
      }),
    ).toBe(
      'https://dev.azure.test/acme/Shop%20Team/_git/shop?path=/{path}&version=GCabc123&line={line}',
    );
  });

  it('is undefined outside a CI and without a template', () => {
    expect(fileUrlTemplateOf(undefined, {})).toBeUndefined();
  });
});

describe('fileUrlOf', () => {
  it('fills the path, with each segment encoded, and the line', () => {
    expect(
      fileUrlOf('https://example.test/{path}#L{line}', 'features/checkout/pay file.feature', 9),
    ).toBe('https://example.test/features/checkout/pay%20file.feature#L9');
  });

  it('is undefined for a link that is not https', () => {
    expect(fileUrlOf('http://example.test/{path}#L{line}', 'a.feature', 1)).toBeUndefined();
  });

  it('is undefined for a template that is not a URL', () => {
    expect(fileUrlOf('not a url {path}', 'a.feature', 1)).toBeUndefined();
  });

  it('is undefined for a link over 2048 characters', () => {
    const long = `https://example.test/${'a'.repeat(2100)}/{path}`;
    expect(fileUrlOf(long, 'a.feature', 1)).toBeUndefined();
  });
});
