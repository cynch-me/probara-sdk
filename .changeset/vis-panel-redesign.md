---
'@probara/vis': minor
---

Redesign the Vis panel and launcher in the look of Probara's recording page: the Probara mark and
link at the top, a Microphone switch, whether it is recording or paused with the time against the
limit and a progress bar, an icon beside each message, and the confirmations in place of the
review. The panel and the launcher follow the page's `color-scheme` (dark on a dark page); the
launcher's default colours are now the panel's card colours; `--probara-vis-accent` and
`--probara-vis-accent-contrast` still override them, and are set together (the text no longer
defaults to white). The review of an instant replay no longer shows counts of console errors and
failed requests, which still reach Probara, nor a hint under **What happened?**; its **Close**
keeps the instant replay and what was typed for the next time the panel opens. The recording link's messages now carry a
title and what to do next.
