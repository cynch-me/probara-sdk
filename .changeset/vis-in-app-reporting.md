---
'@probara/vis': minor
'@probara/vis-capture': minor
---

In-app reporting: `createReporter` starts Probara Vis in your own app with a widget key, so your
users report a bug from whatever page they are on. The panel offers **Send what just happened**,
an instant replay of the last minutes (a rolling DOM replay with the console, network and user
events of the last five minutes, buffered in memory and sent only when the user sends it), and
**Record from the start**, the screen recording of recording links. Open it from your own button
(`reporter.open()`) or an optional floating launcher coloured by `--probara-vis-accent` and
`--probara-vis-accent-contrast`; the script tag reads `data-widget-key` and `data-launcher`. The
replay recorder loads lazily, after the page is idle, and only for a widget that keeps an instant
replay. Verified reporters: `signReporterToken` from `@probara/vis/reporter-token` signs the
reporter's token on your backend (Web Crypto only), and the panel tells each refusal of the widget
intake in English and Spanish. Recording links work as before.

`@probara/vis-capture`: the session's buffer limits take a time window (`maxAgeMs`); the replay
recorder takes a `mutationLimit` and says why it stopped (`stopReason`, `REPLAY_MUTATION_LIMIT`);
`createBlurController({ render: false })` tracks what is blurred without changing how the page looks.
