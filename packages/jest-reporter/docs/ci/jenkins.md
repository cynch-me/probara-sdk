# Jenkins

Bind the token from a credential into the test stage with `withCredentials`; the reporter runs
inside `npx jest`.

## 1. Add the credential

**Manage Jenkins → Credentials → (a domain) → Add Credentials**: kind **Secret text**, ID
`probara-api-token`, the token as the secret. The token is an app token from the **Jest** card in
**Integrations** ([get a token](../configuration.md#get-a-token)).

## 2. The pipeline

A declarative `Jenkinsfile` with Node.js 22 on the agent, and the reporter registered in
`jest.config.js` as in the [quick start](../../README.md#quick-start):

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
          sh 'npx jest --ci'
        }
      }
    }
  }
}
```

Jenkins masks the bound secret in the build log. Failed tests fail the stage, reporting problems
do not ([reporting never breaks your test run](../../README.md#reporting-never-breaks-your-test-run)).

## Parallel stages: one run

Parallel stages that run `--shard`s make one run each unless they share one: create it in a first
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
        stage('Shard 1') {
          steps {
            withCredentials([string(credentialsId: 'probara-api-token', variable: 'PROBARA_API_TOKEN')]) {
              sh 'npx jest --ci --shard=1/2'
            }
          }
        }
        stage('Shard 2') {
          steps {
            withCredentials([string(credentialsId: 'probara-api-token', variable: 'PROBARA_API_TOKEN')]) {
              sh 'npx jest --ci --shard=2/2'
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

Both shards share one workspace here, installed once before they start (two `npm ci` at the same
time in one folder would break each other); on separate agents, each checks out and installs on
its own ([sharding](sharding.md#create-the-run-report-from-each-shard-close-it)).

## What CI detection fills in

With `JENKINS_URL` set, the run is named `JOB_NAME #BUILD_NUMBER`, and its branch, commit and build
URL come from `BRANCH_NAME` (or `GIT_BRANCH`), `GIT_COMMIT` and `BUILD_URL`
([what each CI fills in](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#ci-detection)).

## See also

- [Sharding](sharding.md), [results file](../results-file.md), [troubleshooting](../troubleshooting.md).
