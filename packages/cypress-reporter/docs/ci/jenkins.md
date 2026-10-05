# Jenkins

Bind the token from a credential into the test stage with `withCredentials`; the reporter runs
inside `npx cypress run`.

## 1. Add the credential

**Manage Jenkins → Credentials → (a domain) → Add Credentials**: kind **Secret text**, ID
`probara-api-token`, the token as the secret. The token is an app token from the **Cypress** card in
**Integrations** ([get a token](../configuration.md#get-a-token)).

## 2. The pipeline

A declarative `Jenkinsfile` with Node.js 22 and the system libraries Cypress needs on the agent, and the reporter registered in
`cypress.config.js` as in the [quick start](../../README.md#quick-start):

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
        withCredentials([string(credentialsId: 'probara-api-token', variable: 'PROBARA_API_TOKEN')]) {
          sh 'npx cypress run'
        }
      }
    }
  }
}
```

Jenkins masks the bound secret in the build log. Failed tests fail the stage, reporting problems
do not ([reporting never breaks your test run](../../README.md#reporting-never-breaks-your-test-run)).

## Parallel stages: one run

Parallel stages that each run part of the specs make one run each unless they share one: create it in a first
stage, pass it to each, and close it in a `post { always { ... } }` block:

```groovy
pipeline {
  agent any
  environment {
    PROBARA_PROJECT = 'SHOP'
  }
  stages {
    stage('Create the Probara run') {
      steps {
        sh 'npm ci'
        withCredentials([string(credentialsId: 'probara-api-token', variable: 'PROBARA_API_TOKEN')]) {
          sh 'npx @probara/cli run create > probara-run-ulid'
        }
        script {
          env.PROBARA_RUN_ULID = readFile('probara-run-ulid').trim()
        }
      }
    }
    stage('Test') {
      parallel {
        stage('Cart') {
          steps {
            withCredentials([string(credentialsId: 'probara-api-token', variable: 'PROBARA_API_TOKEN')]) {
              sh "npx cypress run --spec 'cypress/e2e/cart/**'"
            }
          }
        }
        stage('Login') {
          steps {
            withCredentials([string(credentialsId: 'probara-api-token', variable: 'PROBARA_API_TOKEN')]) {
              sh "npx cypress run --spec 'cypress/e2e/login/**'"
            }
          }
        }
      }
    }
  }
  post {
    always {
      withCredentials([string(credentialsId: 'probara-api-token', variable: 'PROBARA_API_TOKEN')]) {
        sh 'npx @probara/cli run close'
      }
    }
  }
}
```

Both stages share one workspace here, installed once before they start (two `npm ci` at the same
time in one folder would break each other); on separate agents, each checks out and installs on
its own ([sharding](sharding.md#create-the-run-report-from-each-machine-close-it)). Two `cypress
run` in one workspace share its screenshots folder, which each one empties when it starts: on one
agent, give each its own (`--config screenshotsFolder=cypress/screenshots-cart`).

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
        script {
          if (env.CHANGE_FORK) {
            withEnv(['PROBARA_ENABLED=false']) {
              sh 'npx cypress run'
            }
          } else {
            withCredentials([string(credentialsId: 'probara-api-token', variable: 'PROBARA_API_TOKEN')]) {
              sh 'npx cypress run'
            }
          }
        }
      }
    }
  }
}
```

In the parallel pipeline, wrap each `withCredentials` the same way: with reporting off, `run create`
writes no ULID and `run close` exits 0 without a token.

## What CI detection fills in

With `JENKINS_URL` set, the run is named `JOB_NAME #BUILD_NUMBER`, and its branch, commit and build
URL come from `BRANCH_NAME` (or `GIT_BRANCH`), `GIT_COMMIT` and `BUILD_URL`
([what each CI fills in](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#ci-detection)).

## See also

- [Sharding](sharding.md), [results file](../results-file.md), [troubleshooting](../troubleshooting.md).
