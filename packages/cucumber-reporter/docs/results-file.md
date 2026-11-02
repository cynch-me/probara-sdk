# Results file

When Probara cannot take a result, the formatter can keep it in a file instead, to send later. Set
`resultsFile` (`PROBARA_RESULTS_FILE=reports/probara-results.json`): at the end of the run, every result
that was not sent is written there. With reporting off, every result is written there.

The file is never overwritten: when one is already there, the formatter writes to the first free name
beside it (`probara-results-2.json`, and so on). The summary line says where it went.

To send the file later, run [`probara import results`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md)
with the same token and project. Its results keep their keys and their case links.
