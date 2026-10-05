#!/usr/bin/env bash
# Regenerates the cypress-junit fixtures in this directory.
# Tool versions used: node v22.14.0, cypress 16.1.1, cypress-junit 0.0.2 (see source/package.json).
#
# Cypress runs in a scratch copy of source/ outside the repository, with its own node_modules:
# `npm install` of a Cypress project inside the workspace would rewrite the root pnpm-lock.yaml.
# The scratch dir is left behind for inspection; only the XML files below are written here.
#
# cypress-junit deletes and rewrites mochaFile for every spec (its `start` handler unlinks it), so
# mochaFile must hold [hash] whenever more than one spec runs, and each junit-<hash>.xml is renamed
# here after the spec its Root Suite names.
#
# The XML embeds the Cypress runner's port and the absolute paths of the machine that generated it
# (in the failure stacks); those are not stable. `cypress run` exits non-zero: the specs contain
# deliberate failures.
set -u
dir=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/probara-cypress-junit-XXXXXX")
echo "generating in $work"
cp -R "$dir/source/." "$work/"
cd "$work"
npm install --no-audit --no-fund
npx cypress run || true

# One file per spec, named after the spec the Root Suite of the document names.
node -e '
const fs = require("node:fs");
const target = process.argv[1];
for (const name of fs.readdirSync(".").filter((each) => /^junit-[0-9a-f]+\.xml$/.test(each))) {
  const file = /<testsuite\b[^>]*\sfile="([^"]+)"/.exec(fs.readFileSync(name, "utf8"))?.[1];
  if (file === undefined) throw new Error(`${name} names no spec file`);
  const spec = file.split("/").pop().replace(/\.cy\.[jt]sx?$/, "");
  fs.copyFileSync(name, `${target}/junit-${spec}.xml`);
}
' "$dir"

# Scripted sanitization of machine-specific strings (see ../README.md). The generation working dir
# (this scratch copy of source/) becomes /work/cypress-junit.
node "$dir/../sanitize.mjs" cypress-junit "$work"
