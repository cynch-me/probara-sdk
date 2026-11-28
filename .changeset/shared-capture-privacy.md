---
'@probara/vis-capture': patch
---

A rolling replay drops everything it held as soon as what is blurred changes, and starts over from a
new full snapshot, so the shared capture never hands over a replay recorded before an SDK attached
with more to blur, even when both happened in the same millisecond. While only error monitoring is
attached, the shared capture records when a WebSocket opened, closed or failed, but none of its
messages.
