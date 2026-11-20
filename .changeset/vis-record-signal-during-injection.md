---
'@probara/cli': patch
---

`probara vis record` no longer misses a Ctrl+C (or SIGTERM) that comes while it injects the capture
script into the page: the recording ends and is uploaded, as with a signal a moment later. Before,
that signal was lost and the recording went on until the page closed or the next signal.
