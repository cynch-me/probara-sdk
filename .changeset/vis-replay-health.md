---
'@probara/vis-capture': minor
'@probara/vis': minor
---

The DOM replay measures its own health: `health` reports why it stopped, its checkouts, the size
held and recorded, its largest mutation batch and the main-thread time rrweb and the recorder spent,
and `coverage` gives the span held without reading the events. `replayHealthEvent` turns the
health into a `probara/replay-health` custom event, which `@probara/vis` adds at the end of every
instant replay it sends. Held events are kept as JSON text.
