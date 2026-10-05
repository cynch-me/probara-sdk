# Interactive mode

A `cypress open` session is not a run to close: it is a session. Every spec you run in it reports
into **one run per session**, and that run is **never closed** by the reporter — close it yourself
when the session is over.

```bash
PROBARA_API_TOKEN=… PROBARA_PROJECT=SHOP npx cypress open
```

That is the whole difference from `cypress run`, and it is Cypress's own flag that decides: the
plugin reads `config.isInteractive` and turns closing off for the session
([run options](runs.md#who-closes-the-run)).

## What an interactive session reports

| What                     | In a `cypress run`                          | In a `cypress open` session                                                                  |
| ------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| The run                  | Created at the beginning, closed at the end | Created when the session starts, **never closed** by the reporter                            |
| `closeRun`               | `true` by default                           | Ignored: an interactive session never closes its run                                         |
| Results                  | Every spec that ran                         | Every spec that ran, every time you run it, into the same run                                |
| The run's name           | The CI build name, else `Automated run …`   | No CI variables locally: `Automated run <date> <time> UTC`, unless `run.name` says otherwise |
| Screenshots of a failure | Attached to the failed attempt              | The same, for each spec you run                                                              |

Everything else is the same as a `cypress run`: the keys, the case links, the steps, the files, the
helpers of the support file, the status of every attempt
([registration](configuration.md#registration)). The token is read from the environment as usual, so
a local session with no token in it sends nothing and stays quiet
([troubleshooting](troubleshooting.md#nothing-is-reported-and-nothing-is-logged)).

## Closing the run

When the session ends, the plugin logs the run and the command that closes it:

```text
[probara] The run R-1 of SHOP stays open: close it in Probara, or with probara run close --project SHOP --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
```

```bash
npx @probara/cli run close --project SHOP --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
```

Closing a run that is already closed exits 0, so the command is safe to run twice. In Probara, the
run can also be closed from its own page.

## Reusing a run across sessions

An interactive run left open can be reused by the next one: pass its ULID and the reporter reports
into it, as it does for a [shard](ci/sharding.md).

```bash
PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 PROBARA_API_TOKEN=… PROBARA_PROJECT=SHOP npx cypress open
```

A reused run is never closed by a report either, whichever mode it runs in.

## See also

- [Run options](runs.md): who closes a run, and when.
- [Sharding and CI](ci/sharding.md): the other reason a run is left open.
- [Troubleshooting](troubleshooting.md): what to do when a session reports nothing.
