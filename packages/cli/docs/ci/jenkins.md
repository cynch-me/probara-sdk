# Jenkins

Run the import in `post { always { ... } }`, so it runs whatever the stages did, with the token
from a Jenkins credential.

## 1. Add the credential

**Manage Jenkins → Credentials → (a domain) → Add Credentials**: kind **Secret text**, ID
`probara-api-token`, the token as the secret. `withCredentials` then puts it in
`PROBARA_API_TOKEN` for the steps inside it, and masks it in the build log. The token is an app
token from the **JUnit XML** card in **Integrations**
([get a token](../configuration.md#get-a-token)).

## 2. Add the step

A complete declarative `Jenkinsfile` for a Maven project. It uses the NodeJS plugin for a Node.js
22 installation named `node-22` (any agent with Node.js 22.12 or later works):

```groovy
pipeline {
  agent any
  tools {
    maven 'maven-3'
    nodejs 'node-22'
  }
  environment {
    PROBARA_PROJECT = 'SHOP'
  }
  stages {
    stage('Test') {
      steps {
        sh 'mvn -B test'
      }
    }
  }
  post {
    always {
      withCredentials([string(credentialsId: 'probara-api-token', variable: 'PROBARA_API_TOKEN')]) {
        sh 'npx @probara/cli import junit target/surefire-reports'
      }
    }
  }
}
```

Keep the single quotes of `sh '...'`: Groovy then leaves `$` alone, and the token is never
interpolated into the script text.

## Run it even when the tests fail

`post { always { ... } }` runs after the stages whatever their result. When `mvn test` fails, the
build is already failed; the import exits 0 for failed tests, so it does not change that
([exit codes](../exit-codes.md)). To keep a Probara outage from failing the build, wrap the step
in `catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') { ... }`.

## What CI detection fills in

With `JENKINS_URL` set:

| Field     | From                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------- |
| Run name  | `JOB_NAME #BUILD_NUMBER`                                                                            |
| Branch    | `BRANCH_NAME` (multibranch), else `GIT_BRANCH` without `origin/`; none for a tag build (`TAG_NAME`) |
| Commit    | `GIT_COMMIT`                                                                                        |
| Build URL | `BUILD_URL`                                                                                         |

A freestyle or pipeline job without the Git plugin's variables sends no branch or commit: set
`PROBARA_BRANCH` and `PROBARA_COMMIT` in `environment { }` if you need them.

## Fork pull requests

Jenkins does not hide credentials from builds of pull requests by itself: a multibranch job that
builds forks can hand the token to their code. Set **Discover pull requests from forks → Trust**
so that a pull request from anyone else builds with the `Jenkinsfile` of its target branch: in the
GitHub branch source, **From users with Admin or Write permission** (or **Nobody**); in the
Bitbucket branch source, **Nobody**, or **Forks in the same account** from plugin version 871 on
(the fix for CVE-2024-28152). **Everyone** builds a fork with its own `Jenkinsfile`, which can bind
the credential itself. In the target branch's `Jenkinsfile`, skip reporting for fork builds
(`env.CHANGE_FORK` is set for them) with a `when` condition or an `if` in a `script { }` block.

## See also

- [Sharded runs](sharding.md): `parallel` stages into one run.
- [Configuration](../configuration.md).
- [Troubleshooting](../troubleshooting.md).
