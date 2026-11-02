# Retries

cucumber-js retries a failed scenario with `--retry <n>` (or `retry` in the configuration). The
formatter sends every attempt as a result of its own, in the order they ran, as the other reporters
do with retries:

```bash
npx cucumber-js --retry 2 --format @probara/cucumber-reporter
```

A scenario that fails once and then passes arrives as two results of one key: the failed attempt,
then the passed one. A scenario that is not retried sends one result.
