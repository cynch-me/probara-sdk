---
'@probara/vis-capture': minor
'@probara/vis': minor
---

A replay keeps only the address of a linked stylesheet the Probara servers can download, instead of
inlining its CSS into every full snapshot: about 40 ms of main-thread time and 1.3 MB less per
snapshot for a typical Angular app. It still inlines them on a page the servers never reach
(`localhost`, private hosts and addresses, other ports) and when a stylesheet is larger than the
2 MiB they keep. `inlineStylesheets` overrides the choice, for example for stylesheets behind a
sign-in.
