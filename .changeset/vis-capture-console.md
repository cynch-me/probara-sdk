---
'@probara/vis-capture': minor
---

New package: the browser capture engine of Probara Vis. It records the console (every level, stack
traces, uncaught errors and unhandled rejections) into a recording session with bounded buffers,
defines the diagnostics entry types with runtime guards, writes them as gzip-compressed NDJSON, and
redacts secrets with built-in rules and fail-closed sanitizers. It ships as an ES module and as a
script-tag build that sets the global `ProbaraVisCapture`.
