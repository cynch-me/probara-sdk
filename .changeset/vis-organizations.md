---
'@probara/vis': minor
---

**Breaking:** the recorder now requires the `organizations` option (`data-organizations` on the
script tag, separated by spaces or commas): the IDs of the Probara organizations the page serves,
1 to 20, shown in Probara under Vis settings next to the recording domains. Without valid
organizations, `startRecorder` and `startRecorderFromUrl` return `null` and log one console
warning, and `startRecorderFromUrl` leaves the token in the address. Every intake request names
them in the `probara-organizations` header, and the intake serves a link only for one of them, so
another organization cannot record visitors through your page. Recording domains are declared in
Probara with no DNS record, and the panel's refusal message names both causes: the page's domain
must be a recording domain of the organization, and the page must name the organization.
