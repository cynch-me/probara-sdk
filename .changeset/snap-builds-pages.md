---
'@probara/core': patch
---

Probara Snap: `listSnapBuilds` lists builds a page at a time and answers
`{ items, page, pageSize, total }`. It takes `page` and `pageSize` in place of `limit` and
`cursor`, and searches and filters with `q`, `type`, `status` and `review`. Waiting for a
build reads the newest match with `pageSize: 1`.
