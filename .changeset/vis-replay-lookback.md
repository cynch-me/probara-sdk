---
'@probara/vis-capture': minor
---

A rolling DOM replay keeps the newest segments that reach back `lookbackMs` (the checkout interval
unless given), within `maxSize` (`REPLAY_MAX_SIZE`, 16 MiB of JSON): past it the oldest segments
are dropped, and a segment holding more than half of it starts a new one early, so a busy page keeps
recording within a bounded amount of memory.
