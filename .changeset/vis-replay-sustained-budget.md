---
'@probara/vis-capture': minor
'@probara/vis': minor
---

The instant replay no longer pauses on the burst of a navigation. A replay budget now pauses only
once the page stayed busy for `busyWindows` windows in a row (`REPLAY_BUDGET`: three windows of
2 s over 100 ms each), no longer compares against the longest full snapshot so far, and resumes at
the end of the first window whose changes fit the budget again, with `pauseMs` as the longest
wait. BREAKING: `ReplayBudget` requires `busyWindows`, and the `probara/replay-paused` payload
carries `busyWindows` and `resumeWithinMs` (the longest wait) in place of `resumeInMs`.
