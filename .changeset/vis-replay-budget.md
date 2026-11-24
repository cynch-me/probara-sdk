---
'@probara/vis-capture': minor
'@probara/vis': minor
---

A DOM replay on a busy page pauses instead of stopping for the rest of the session. `budget`
(`REPLAY_BUDGET`, 100 ms of main-thread time on DOM changes in any 2 s, for the instant replay of
`@probara/vis`) replaces `mutationLimit`: once the changes cost more than it and than a full
snapshot, the replay marks a `probara/replay-paused` event, records nothing for 10 s, and resumes
from a new full snapshot, waiting twice as long after each pause that follows, up to the checkout
interval. `paused` and `health.pauses` tell it.
`mutationLimit`, `REPLAY_MUTATION_LIMIT`, `REPLAY_STOPPED_TAG`, `ReplayStopReason` and
`stopReason` are removed. An Angular table re-render that stopped the instant replay at once now
records through.
