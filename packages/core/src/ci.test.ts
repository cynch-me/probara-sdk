import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectCiSource, detectSnapCiSource } from './ci.js';

const github = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REF_NAME: 'main',
  GITHUB_HEAD_REF: '',
  GITHUB_SHA: 'a1b2c3d4',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'acme/shop',
  GITHUB_RUN_ID: '9876',
  GITHUB_WORKFLOW: 'CI',
  GITHUB_RUN_NUMBER: '42',
};

describe('detectCiSource', () => {
  it('returns nothing outside a known CI provider', () => {
    expect(detectCiSource({ PATH: '/usr/bin', CI: 'true' })).toEqual({});
  });

  describe('GitHub Actions', () => {
    it('reads the ref name, commit, run URL, workflow run name and the CI run', () => {
      expect(detectCiSource(github)).toEqual({
        provider: 'github-actions',
        branch: 'main',
        commit: 'a1b2c3d4',
        buildUrl: 'https://github.com/acme/shop/actions/runs/9876',
        buildName: 'CI #42',
        repository: 'acme/shop',
        workflow: 'CI',
        ciRunId: '9876',
      });
    });

    it('reads the actor, job, attempt and pull request of a pull request build', () => {
      expect(
        detectCiSource({
          ...github,
          GITHUB_REF: 'refs/pull/17/merge',
          GITHUB_REF_NAME: '17/merge',
          GITHUB_HEAD_REF: 'feat/cart',
          GITHUB_ACTOR: 'octocat',
          GITHUB_JOB: 'e2e',
          GITHUB_RUN_ATTEMPT: '2',
        }),
      ).toEqual({
        provider: 'github-actions',
        branch: 'feat/cart',
        commit: 'a1b2c3d4',
        buildUrl: 'https://github.com/acme/shop/actions/runs/9876',
        buildName: 'CI #42',
        repository: 'acme/shop',
        commitAuthor: 'octocat',
        pullRequestNumber: 17,
        workflow: 'CI',
        ciRunId: '9876',
        ciRunAttempt: 2,
        ciJob: 'e2e',
      });
    });

    it('reads a pull request number only from a refs/pull/<n>/merge ref', () => {
      const pullRequestOf = (ref: string) =>
        detectCiSource({ ...github, GITHUB_REF: ref }).pullRequestNumber;
      expect(pullRequestOf('refs/pull/4021/merge')).toBe(4021);
      expect(pullRequestOf('refs/heads/main')).toBeUndefined();
      expect(pullRequestOf('refs/tags/v1.2.0')).toBeUndefined();
      expect(pullRequestOf('refs/pull/abc/merge')).toBeUndefined();
      expect(pullRequestOf('refs/pull/0/merge')).toBeUndefined();
      expect(pullRequestOf('refs/pull/17/merge/extra')).toBeUndefined();
    });

    it('reads the run attempt as a positive integer, and leaves out anything else', () => {
      const attemptOf = (value: string) =>
        detectCiSource({ ...github, GITHUB_RUN_ATTEMPT: value }).ciRunAttempt;
      expect(attemptOf('1')).toBe(1);
      expect(attemptOf('3')).toBe(3);
      expect(attemptOf('0')).toBeUndefined();
      expect(attemptOf('-1')).toBeUndefined();
      expect(attemptOf('1.5')).toBeUndefined();
      expect(attemptOf('two')).toBeUndefined();
      expect(attemptOf('  ')).toBeUndefined();
    });

    it('takes the ref name as the branch when the head ref is blank (a push)', () => {
      expect(
        detectCiSource({ ...github, GITHUB_HEAD_REF: '', GITHUB_REF_NAME: 'dev' }).branch,
      ).toBe('dev');
    });

    it('prefers the pull request head branch over the merge ref', () => {
      expect(
        detectCiSource({ ...github, GITHUB_REF_NAME: '17/merge', GITHUB_HEAD_REF: 'feat/cart' })
          .branch,
      ).toBe('feat/cart');
    });

    it('sends no branch for a tag build, unless PROBARA_BRANCH sets one', () => {
      const tag = { ...github, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.2.0' };
      expect(detectCiSource(tag)).not.toHaveProperty('branch');
      expect(detectCiSource(tag).commit).toBe('a1b2c3d4');
      expect(detectCiSource({ ...tag, PROBARA_BRANCH: 'release' }).branch).toBe('release');
      expect(detectCiSource({ ...github, GITHUB_REF_TYPE: 'branch' }).branch).toBe('main');
    });

    it('omits composed values whose inputs are missing', () => {
      const { buildUrl, buildName, commit } = detectCiSource({
        GITHUB_ACTIONS: 'true',
        GITHUB_SHA: 'ffff',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_RUN_NUMBER: '3',
      });
      expect(commit).toBe('ffff');
      expect(buildUrl).toBeUndefined();
      expect(buildName).toBeUndefined();
    });
  });

  it('reads no CI run of another provider: its source stays branch, commit and build URL', () => {
    const info = detectCiSource({
      GITLAB_CI: 'true',
      CI_COMMIT_REF_NAME: 'main',
      CI_COMMIT_SHA: 'abc123',
      CI_PIPELINE_URL: 'https://gitlab.com/acme/shop/-/pipelines/55',
      // GitHub variables without GITHUB_ACTIONS=true are not GitHub Actions.
      GITHUB_REPOSITORY: 'acme/shop',
      GITHUB_RUN_ID: '9876',
      GITHUB_REF: 'refs/pull/17/merge',
    });
    expect(Object.keys(info).sort()).toEqual(['branch', 'buildUrl', 'commit', 'provider']);
  });

  it('reads GitLab, preferring the merge request source branch', () => {
    const env = {
      GITLAB_CI: 'true',
      CI_COMMIT_REF_NAME: 'main',
      CI_COMMIT_SHA: 'abc123',
      CI_PIPELINE_URL: 'https://gitlab.com/acme/shop/-/pipelines/55',
      CI_PROJECT_NAME: 'shop',
      CI_PIPELINE_IID: '12',
    };
    expect(detectCiSource(env)).toEqual({
      provider: 'gitlab',
      branch: 'main',
      commit: 'abc123',
      buildUrl: 'https://gitlab.com/acme/shop/-/pipelines/55',
      buildName: 'shop #12',
    });
    expect(
      detectCiSource({ ...env, CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'fix/login' }).branch,
    ).toBe('fix/login');

    const tag = { ...env, CI_COMMIT_TAG: 'v1.2.0', CI_COMMIT_REF_NAME: 'v1.2.0' };
    expect(detectCiSource(tag)).not.toHaveProperty('branch');
    expect(
      detectCiSource({ ...tag, CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'fix/login' }).branch,
    ).toBe('fix/login');
  });

  it('reads CircleCI', () => {
    expect(
      detectCiSource({
        CIRCLECI: 'true',
        CIRCLE_BRANCH: 'develop',
        CIRCLE_SHA1: 'c1c1',
        CIRCLE_BUILD_URL: 'https://circleci.com/gh/acme/shop/77',
        CIRCLE_PROJECT_REPONAME: 'shop',
        CIRCLE_BUILD_NUM: '77',
      }),
    ).toEqual({
      provider: 'circleci',
      branch: 'develop',
      commit: 'c1c1',
      buildUrl: 'https://circleci.com/gh/acme/shop/77',
      buildName: 'shop #77',
    });
  });

  describe('Azure Pipelines', () => {
    const azure = {
      TF_BUILD: 'True',
      BUILD_SOURCEBRANCH: 'refs/heads/release/2.0',
      BUILD_SOURCEVERSION: 'aaaa1111',
      SYSTEM_COLLECTIONURI: 'https://dev.azure.com/acme/',
      SYSTEM_TEAMPROJECT: 'Shop',
      BUILD_BUILDID: '301',
      BUILD_DEFINITIONNAME: 'shop-ci',
      BUILD_BUILDNUMBER: '20260929.1',
    };

    it('strips refs/heads/ and builds the results URL', () => {
      expect(detectCiSource(azure)).toEqual({
        provider: 'azure-pipelines',
        branch: 'release/2.0',
        commit: 'aaaa1111',
        buildUrl: 'https://dev.azure.com/acme/Shop/_build/results?buildId=301',
        buildName: 'shop-ci #20260929.1',
      });
    });

    it('sends no branch for a tag build', () => {
      expect(
        detectCiSource({ ...azure, BUILD_SOURCEBRANCH: 'refs/tags/v1.2.0' }),
      ).not.toHaveProperty('branch');
    });

    it('prefers the pull request source branch and encodes the team project', () => {
      const info = detectCiSource({
        ...azure,
        BUILD_SOURCEBRANCH: 'refs/pull/9/merge',
        SYSTEM_PULLREQUEST_SOURCEBRANCH: 'refs/heads/feat/pay',
        SYSTEM_COLLECTIONURI: 'https://dev.azure.com/acme',
        SYSTEM_TEAMPROJECT: 'Web Shop',
      });
      expect(info.branch).toBe('feat/pay');
      expect(info.buildUrl).toBe(
        'https://dev.azure.com/acme/Web%20Shop/_build/results?buildId=301',
      );
    });
  });

  describe('Jenkins', () => {
    const jenkins = {
      JENKINS_URL: 'https://ci.acme.test/',
      GIT_COMMIT: 'beef',
      BUILD_URL: 'https://ci.acme.test/job/shop/8/',
      JOB_NAME: 'shop',
      BUILD_NUMBER: '8',
    };

    it('reads the multibranch branch name', () => {
      expect(detectCiSource({ ...jenkins, BRANCH_NAME: 'main', GIT_BRANCH: 'origin/x' })).toEqual({
        provider: 'jenkins',
        branch: 'main',
        commit: 'beef',
        buildUrl: 'https://ci.acme.test/job/shop/8/',
        buildName: 'shop #8',
      });
    });

    it('sends no branch for a multibranch tag build', () => {
      const tag = { ...jenkins, BRANCH_NAME: 'v1.2.0', TAG_NAME: 'v1.2.0' };
      expect(detectCiSource(tag)).not.toHaveProperty('branch');
      expect(detectCiSource({ ...tag, BRANCH_NAME: 'main' }).branch).toBe('main');
    });

    it('falls back to the git plugin branch without its origin/ prefix', () => {
      expect(detectCiSource({ ...jenkins, GIT_BRANCH: 'origin/feature/a' }).branch).toBe(
        'feature/a',
      );
    });
  });

  it('reads Bitbucket Pipelines', () => {
    expect(
      detectCiSource({
        BITBUCKET_BUILD_NUMBER: '15',
        BITBUCKET_BRANCH: 'main',
        BITBUCKET_COMMIT: 'b1b1',
        BITBUCKET_REPO_FULL_NAME: 'acme/shop',
        BITBUCKET_REPO_SLUG: 'shop',
      }),
    ).toEqual({
      provider: 'bitbucket',
      branch: 'main',
      commit: 'b1b1',
      buildUrl: 'https://bitbucket.org/acme/shop/pipelines/results/15',
      buildName: 'shop #15',
    });
  });

  it('reads Buildkite', () => {
    expect(
      detectCiSource({
        BUILDKITE: 'true',
        BUILDKITE_BRANCH: 'main',
        BUILDKITE_COMMIT: 'bk01',
        BUILDKITE_BUILD_URL: 'https://buildkite.com/acme/shop/builds/4',
        BUILDKITE_PIPELINE_SLUG: 'shop',
        BUILDKITE_BUILD_NUMBER: '4',
      }),
    ).toEqual({
      provider: 'buildkite',
      branch: 'main',
      commit: 'bk01',
      buildUrl: 'https://buildkite.com/acme/shop/builds/4',
      buildName: 'shop #4',
    });
  });

  it('sends no Buildkite branch for a tag build, where the branch is the tag', () => {
    const env = { BUILDKITE: 'true', BUILDKITE_COMMIT: 'bk01', BUILDKITE_TAG: 'v1.2.0' };
    expect(detectCiSource({ ...env, BUILDKITE_BRANCH: 'v1.2.0' })).not.toHaveProperty('branch');
    expect(detectCiSource({ ...env, BUILDKITE_BRANCH: 'main' }).branch).toBe('main');
  });

  it('lets PROBARA_BRANCH, PROBARA_COMMIT and PROBARA_BUILD_URL override the detected values', () => {
    expect(
      detectCiSource({
        ...github,
        PROBARA_BRANCH: 'release',
        PROBARA_COMMIT: '0123abcd',
        PROBARA_BUILD_URL: 'https://ci.acme.test/42',
      }),
    ).toEqual({
      provider: 'github-actions',
      branch: 'release',
      commit: '0123abcd',
      buildUrl: 'https://ci.acme.test/42',
      buildName: 'CI #42',
      repository: 'acme/shop',
      workflow: 'CI',
      ciRunId: '9876',
    });
    expect(detectCiSource({ PROBARA_COMMIT: 'feed' })).toEqual({ commit: 'feed' });
  });

  it('treats blank variables as unset', () => {
    expect(detectCiSource({ ...github, GITHUB_SHA: '  ', PROBARA_BRANCH: '' })).not.toHaveProperty(
      'commit',
    );
    expect(detectCiSource({ ...github, PROBARA_BRANCH: '' }).branch).toBe('main');
  });
});

describe('detectSnapCiSource', () => {
  const HEAD = 'b'.repeat(40);
  const MERGE = 'c'.repeat(40);
  const pullRequest = {
    ...github,
    GITHUB_SHA: MERGE,
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: '/github/workflow/event.json',
    GITHUB_REF: 'refs/pull/17/merge',
    GITHUB_HEAD_REF: 'feat/cart',
    GITHUB_BASE_REF: 'main',
    GITHUB_RUN_ATTEMPT: '2',
  };
  const event = () => JSON.stringify({ pull_request: { head: { sha: HEAD } } });

  it('reads the head commit of a GitHub pull request from the event payload, not the merge commit', () => {
    const read: string[] = [];
    const info = detectSnapCiSource(pullRequest, (path) => {
      read.push(path);
      return event();
    });

    expect(info.headCommit).toBe(HEAD);
    expect(info.commit).toBe(MERGE);
    expect(read).toEqual(['/github/workflow/event.json']);
  });

  it('reads the event payload from the file at GITHUB_EVENT_PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'probara-core-ci-'));
    try {
      const path = join(dir, 'event.json');
      writeFileSync(path, event());
      expect(detectSnapCiSource({ ...pullRequest, GITHUB_EVENT_PATH: path }).headCommit).toBe(HEAD);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes the commit as the head commit outside a pull request, or without a readable payload', () => {
    const unreadable = () => {
      throw new Error('ENOENT');
    };
    expect(detectSnapCiSource(github, event).headCommit).toBe('a1b2c3d4');
    expect(detectSnapCiSource(pullRequest, unreadable).headCommit).toBe(MERGE);
    expect(detectSnapCiSource(pullRequest, () => '{"pull_request":{}}').headCommit).toBe(MERGE);
    expect(detectSnapCiSource(pullRequest, () => 'not json').headCommit).toBe(MERGE);
    expect(
      detectSnapCiSource({ GITLAB_CI: 'true', CI_COMMIT_SHA: HEAD }, unreadable).headCommit,
    ).toBe(HEAD);
    expect(
      detectSnapCiSource({ ...pullRequest, PROBARA_COMMIT: 'd'.repeat(40) }, event),
    ).toMatchObject({ commit: 'd'.repeat(40), headCommit: 'd'.repeat(40) });
  });

  it('reads the base branch each provider documents for a pull request', () => {
    const base = (env: Record<string, string>) => detectSnapCiSource(env, event).baseBranch;

    expect(base(pullRequest)).toBe('main');
    expect(base(github)).toBeUndefined();
    expect(base({ GITLAB_CI: 'true', CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'develop' })).toBe(
      'develop',
    );
    expect(base({ TF_BUILD: 'True', SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/main' })).toBe(
      'main',
    );
    expect(base({ JENKINS_URL: 'https://ci', CHANGE_TARGET: 'main' })).toBe('main');
    expect(base({ BITBUCKET_BUILD_NUMBER: '3', BITBUCKET_PR_DESTINATION_BRANCH: 'main' })).toBe(
      'main',
    );
    expect(base({ BUILDKITE: 'true', BUILDKITE_PULL_REQUEST_BASE_BRANCH: 'main' })).toBe('main');
    expect(base({ CIRCLECI: 'true', CIRCLE_BRANCH: 'feat/cart' })).toBeUndefined();
  });

  it('derives the nonce from the run id and attempt on GitHub, and from the pipeline id elsewhere', () => {
    const nonce = (env: Record<string, string>) => detectSnapCiSource(env, event).snapNonce;

    expect(nonce(pullRequest)).toBe('9876-2');
    expect(nonce(github)).toBe('9876-1');
    expect(nonce({ GITHUB_ACTIONS: 'true' })).toBeUndefined();
    expect(nonce({ GITLAB_CI: 'true', CI_PIPELINE_ID: '4521' })).toBe('4521');
    expect(nonce({ CIRCLECI: 'true', CIRCLE_WORKFLOW_ID: 'f3a1' })).toBe('f3a1');
    expect(nonce({ TF_BUILD: 'True', BUILD_BUILDID: '88' })).toBe('88');
    expect(nonce({ JENKINS_URL: 'https://ci', BUILD_TAG: 'jenkins-shop-12' })).toBe(
      'jenkins-shop-12',
    );
    expect(nonce({ BITBUCKET_BUILD_NUMBER: '3', BITBUCKET_PIPELINE_UUID: '{ab-1}' })).toBe(
      '{ab-1}',
    );
    expect(nonce({ BUILDKITE: 'true', BUILDKITE_BUILD_ID: '0190-ab' })).toBe('0190-ab');
    expect(nonce({ PATH: '/usr/bin' })).toBeUndefined();
  });

  it('adds its fields to what detectCiSource reports, which stays as it was', () => {
    const before = {
      provider: 'github-actions',
      branch: 'feat/cart',
      commit: MERGE,
      buildUrl: 'https://github.com/acme/shop/actions/runs/9876',
      buildName: 'CI #42',
      repository: 'acme/shop',
      pullRequestNumber: 17,
      workflow: 'CI',
      ciRunId: '9876',
      ciRunAttempt: 2,
    };

    expect(detectCiSource(pullRequest)).toEqual(before);
    expect(detectSnapCiSource(pullRequest, event)).toEqual({
      ...before,
      headCommit: HEAD,
      baseBranch: 'main',
      snapNonce: '9876-2',
    });
  });
});
