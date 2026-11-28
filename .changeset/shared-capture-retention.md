---
'@probara/vis-capture': minor
'@probara/vis': patch
---

The shared capture keeps only what the attached SDKs need. An SDK that attaches with
`retention: 'errors'` (as `@probara/browser` does) gets a one-minute window, small console,
network and user event buffers (`ERROR_CAPTURE_LIMITS`) and no request or response bodies; as soon
as an SDK that needs the full window attaches (Probara Vis), the capture grows to
`SHARED_CAPTURE_LIMITS` with bodies, keeping what it held, and shrinks back once it leaves. The
replay recorder gains `setLookback()`, recording sessions `setLimits()`, and the network capture a
`captureBodies` option. In `@probara/vis`, recording from the start (and recording links) now
record through the page's shared capture instead of patching the console and network a second time.
