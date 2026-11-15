---
'@probara/vis-capture': minor
'@probara/vis': patch
---

Custom metadata keeps the server's depth limit too: `normalizeMetadata` refuses metadata nested
more than `MAX_METADATA_DEPTH` (32) levels deep, the root object being level 1 and every object or
array inside another adding one, as Probara counts it. The depth is checked with an explicit stack
before anything serializes the value, so metadata nested thousands of levels deep is refused
without overflowing the stack of the page. The walk follows what JSON sends, so a property JSON
leaves out does not count and a top-level `__proto__` key, which Probara drops, is left out. The handshake answers `null` for such metadata, a reader
ignores it, and a `metadata()` provider of `@probara/vis` that returns it is skipped.
