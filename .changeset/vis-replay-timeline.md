---
'@probara/vis': minor
---

An instant replay keeps about the last five minutes of the page, the same window as its console,
network and user events, and ends at the moment it was taken. Its length is the replay's own, from
its first event, instead of starting at the oldest console or network entry, and every entry is
timed from that first event, so the player shows each one where it happened; entries older than the
replay are left out.
