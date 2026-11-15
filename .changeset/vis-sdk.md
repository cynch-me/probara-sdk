---
'@probara/vis': minor
---

New package: the browser SDK of Probara Vis for a customer's own site. `startRecorderFromUrl()`
opens an in-page recorder when a visitor arrives through a recording link
(`?probara-recording=<token>`, taken out of the address bar at once): a "Ready to record?" card
with Start recording and a microphone toggle; the visitor records the current tab with pause,
resume, stop and discard, then watches the recording in the panel, which can be scrubbed at once,
and chooses Send, Record again or Discard (both confirmed); a recording the panel cannot play
offers Record again and Discard only. Only on Send are the video (uploaded in parts while it records), the
console, network and user events and the environment finalized as a Vis under the link's title,
never longer than the plan's limit. A recording about to outgrow the largest upload stops by
itself, and the panel says which limit stopped it.
Every intake request has a time limit; the finalize's grows with the size of the video. Every ending but a finished one aborts the submission. A
browser that cannot record the screen gets a panel that says so, and nothing is sent. `metadata(provider)` registers custom metadata for the Vises
captured on the page, read by the recorder and by the extension. Elements marked with
`data-probara-blur`, the privacy markers of other session replay tools, `probara:blur` meta tags
and the `blur` option are blurred while recording; the site's sanitizers pass to the capture
engine. It ships as an ES module and as a script-tag build that sets the global `ProbaraVis`. It
sends to `https://app.probara.net` unless `apiOrigin` names another API, which accepts pages on
the organization's verified recording domains; a page on another domain is told so.
