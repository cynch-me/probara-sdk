---
'@probara/cli': minor
---

`probara releases set-commits` tells Probara which commits a release contains, so an issue shows its suspect commits and a commit that says "fixes ERR-<n>" resolves it. `--auto` sends the HEAD of the GitHub repository of the origin remote, `--commit <owner/name>@[<previous>..]<sha>` names repositories and commits, and `--local` sends the commits of the local git log with their authors, times and files; with `--dry-run`, `--json` and retries on 408, 429 and 5xx.
