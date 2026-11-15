---
'@probara/cli': patch
---

A second Ctrl+C during the upload of `probara vis record` no longer retries anything: the requests
in flight end at once, the pending Vis gets one deletion attempt, and one line says whether it was
deleted or left for Probara to delete seven days after its creation.
