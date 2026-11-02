# Jenkins

Sync the feature files on the default branch, then run the tests with the formatter. Store the token
as a secret text credential named `probara-api-token`.

```groovy
pipeline {
  agent { docker { image 'node:22' } }
  environment { PROBARA_PROJECT = 'SHOP' }
  stages {
    stage('Sync Gherkin') {
      when { branch 'main' }
      steps {
        withCredentials([string(credentialsId: 'probara-api-token', variable: 'PROBARA_API_TOKEN')]) {
          sh 'npx @probara/cli sync gherkin "features/**/*.feature"'
        }
      }
    }
    stage('Test') {
      steps {
        withCredentials([string(credentialsId: 'probara-api-token', variable: 'PROBARA_API_TOKEN')]) {
          sh 'npm ci'
          sh 'npx cucumber-js --format @probara/cucumber-reporter'
        }
      }
    }
  }
}
```

The `Sync Gherkin` stage runs on the `main` branch only. See [configuration](../configuration.md).
