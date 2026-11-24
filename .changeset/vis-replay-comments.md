---
'@probara/vis-capture': minor
---

The DOM replay no longer records HTML comments, in both modes: the anchor comments frameworks such as
Angular leave around every template were about a quarter of the mutations on a busy page. A node
inserted next to one still replays in its place.
