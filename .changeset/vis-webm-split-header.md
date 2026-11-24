---
'@probara/vis': patch
---

A recording whose first video frame came late now plays with its duration known at once: the
duration is written into the WebM header even when `MediaRecorder` split the header across
chunks, as it does on a busy machine.
