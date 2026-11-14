---
'@probara/vis': minor
---

New package: the browser SDK of Probara Vis for a customer's own site. `startRecorderFromUrl()`
opens an in-page recorder when a visitor arrives through a recording link
(`?probara-recording=<token>`, taken out of the address bar at once): the visitor records the
current tab with an optional microphone, pause, resume, stop and discard, and the video (uploaded
in parts while it records), the console, network and user events and the environment are sent to
the recording link's intake as a Vis, never longer than the plan's limit. Every ending but a
finished one aborts the submission. `metadata(provider)` registers custom metadata for the Vises
captured on the page, read by the recorder and by the extension. Elements marked with
`data-probara-blur`, the privacy markers of other session replay tools, `probara:blur` meta tags
and the `blur` option are blurred while recording; the site's sanitizers pass to the capture
engine. It ships as an ES module and as a script-tag build that sets the global `ProbaraVis`. The
intake accepts the Probara app's own origin only for now.
