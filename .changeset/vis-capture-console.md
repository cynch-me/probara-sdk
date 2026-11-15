---
'@probara/vis-capture': minor
---

New package: the browser capture engine of Probara Vis. It records the console (every level, stack
traces, uncaught errors and unhandled rejections), the network (fetch, XHR, beacons, resource
loads, GraphQL operations and WebSocket messages), user events and the environment into a recording
session with bounded buffers, each stream in time order (one `input` entry per typing burst), records the video of a stream the caller shares (WebM with VP9 or VP8
where the browser can, MP4 with H.264 otherwise), with blur, and a DOM
replay through the separate `@probara/vis-capture/replay` entry. It defines the diagnostics entry
types with runtime guards, writes them as gzip-compressed NDJSON, and redacts secrets with built-in
rules and fail-closed sanitizers. It ships as ES modules and as script-tag builds that set the
globals `ProbaraVisCapture` and `ProbaraVisCaptureReplay`.
