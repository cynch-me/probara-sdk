---
'@probara/cli': minor
'@probara/core': minor
---

`probara vis record` reads the plan's longest recording from Probara before the recording starts
and stops there, saying so with the plan's limit; `--duration` cannot go past it, and a plan
without a limit records until it is stopped. When the limit cannot be read, the recording keeps
its 60 minutes as before; the command waits at most 3 seconds for it, and Ctrl+C while it waits
ends the command before anything is recorded or created. The core client reads the organization's Vis settings with the plan's
limits: `getVisSettings()` (`GET /api/v1/vis-settings`), with the `VisSettings` and
`VisPlanLimits` types and `VIS_UNLIMITED`.
