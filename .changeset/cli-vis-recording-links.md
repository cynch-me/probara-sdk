---
'@probara/cli': minor
'@probara/core': minor
---

New `probara vis recording-links list|get|create|update|revoke|delete`: manages the recording links
of the organization, URLs anyone records their screen with, no account needed, whose recordings
arrive as Vises. `create` takes the title, folder and reference of the Vises the link receives,
`--one-time`, `--expires` and `--[no-]microphone`, and prints the ULID and the URL of the link;
`revoke` and `delete` ask for a confirmation unless `--yes` is given. The core client gains the
recording link endpoints these commands call (`listVisRecordingLinks`, `getVisRecordingLink`,
`createVisRecordingLink`, `updateVisRecordingLink`, `revokeVisRecordingLink`,
`deleteVisRecordingLink`) and their types.
