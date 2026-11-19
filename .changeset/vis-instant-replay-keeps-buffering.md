---
'@probara/vis': patch
---

The instant replay keeps buffering when the review of **Send what just happened** is closed: the
next time the panel opens, the review shows what happened up to then, with the current time, as
the first one did. In 0.4.0 the panel's **Close** froze the instant replay and showed the same one
again, however long the page was used meanwhile. What was typed in **What happened?** is no longer
kept once the review is closed. `reporter.close()` in the review now does the same as **Close**.
