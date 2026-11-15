---
'@probara/vis-capture': minor
---

Custom metadata over DOM events: `answerMetadataRequests` answers on the page and
`requestPageMetadata` reads from a content script, with JSON string details that cross script
worlds, a versioned handshake, and the server's 10 KiB limit applied on both sides
(`normalizeMetadata`, `MAX_METADATA_BYTES`). `createUserEventCapture` takes `ignore`, so a
recorder's own controls stay out of the user events.
