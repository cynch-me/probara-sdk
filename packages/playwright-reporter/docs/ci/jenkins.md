# Jenkins

Bind the token from a credential into the test stage with `withCredentials`; the reporter runs
inside `npx playwright test`.

## 1. Add the credential

**Manage Jenkins → Credentials → (a domain) → Add Credentials**: kind **Secret text**, ID
`probara-api-token`, the token as the secret. The token is an app token from the **Playwright**
card in **Integrations** ([get a token](../configuration.md#get-a-token)).

## 2. The pipeline

A declarative `Jenkinsfile` with Node.js 22 on the agent:

```groovy
pipeline {
  agent any
  environment {
    PROBARA_PROJECT = 'SHOP'
  }
  stages {
    stage('Test') {
      steps {
        sh 'npm ci'
        sh 'npx playwright install --with-deps'
        withCredentials([string(credentialsId: 'probara-api-token', variable: 'PROBARA_API_TOKEN')]) {
          sh 'npx playwright test'
        }
      }
    }
  }
}
```

Jenkins masks the bound secret in the build log. For parallel stages that share one run, create
it in a first stage and pass `PROBARA_RUN_ULID` to each
([sharding](sharding.md#pattern-2-create-the-run-report-from-each-shard-close-it)).

With `JENKINS_URL` set, the run is named `JOB_NAME #BUILD_NUMBER`, and its branch, commit and build
URL come from `BRANCH_NAME` (or `GIT_BRANCH`), `GIT_COMMIT` and `BUILD_URL`
([what each CI fills in](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#ci-detection)).

## Fork pull requests

Jenkins does not hide credentials from builds of pull requests by itself: a multibranch job that
builds forks can hand the token to their code. Set **Discover pull requests from forks → Trust**
so that a pull request from anyone else builds with the `Jenkinsfile` of its target branch: in the
GitHub branch source, **From users with Admin or Write permission** (or **Nobody**); in the
Bitbucket branch source, **Nobody**, or **Forks in the same account** from plugin version 871 on
(the fix for CVE-2024-28152). **Everyone** builds a fork with its own `Jenkinsfile`, which can bind
the credential itself, and makes the `env.CHANGE_FORK` guard below useless. In the target branch's
`Jenkinsfile`, bind the credential only when `env.CHANGE_FORK` is not set (Jenkins sets it for a
pull request from a fork), and turn reporting off for a fork build:

```groovy
pipeline {
  agent any
  environment {
    PROBARA_PROJECT = 'SHOP'
  }
  stages {
    stage('Test') {
      steps {
        sh 'npm ci'
        sh 'npx playwright install --with-deps'
        script {
          if (env.CHANGE_FORK) {
            withEnv(['PROBARA_ENABLED=false']) {
              sh 'npx playwright test'
            }
          } else {
            withCredentials([string(credentialsId: 'probara-api-token', variable: 'PROBARA_API_TOKEN')]) {
              sh 'npx playwright test'
            }
          }
        }
      }
    }
  }
}
```

For parallel stages that share one run, wrap each `withCredentials` the same way: with reporting
off, `run create` writes no ULID and `run close` exits 0 without a token.

## See also

- [Sharding](sharding.md), [troubleshooting](../troubleshooting.md).
