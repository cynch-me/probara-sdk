#!/bin/sh
# Regenerates recording.webm and trace.zip with the Playwright of packages/vis-capture (1.63.0) and
# its Chromium (pnpm --filter @probara/vis-capture exec playwright install chromium). The script
# runs in a scratch folder under /tmp, so the trace records no path of this machine's user.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d /tmp/probara-vis.XXXXXX)
cp "$here/generate.mjs" "$work/"
(cd "$work" && PROBARA_VIS_CAPTURE="$here/../../../../vis-capture" node generate.mjs)
cp "$work/recording.webm" "$work/trace.zip" "$here/"
rm -rf "$work"
