#!/usr/bin/env bash
# Regenerates the vitest fixtures in this directory: Vitest's built-in junit reporter, per major.
# Tool versions used: node v22.14.0; vitest 3.2.7, 4.1.11 and 5.0.3 (one scratch install each).
#
# Each version runs in its own scratch copy of source/ outside the repository, with its own
# node_modules: the workspace's vitest is never used, and the workspace lockfile is never touched.
# npm 10.9.2 fails to resolve the peer set of vitest@4.1.11 (arborist: "reading 'edgesOut'"), so the
# installs pass --legacy-peer-deps: the optional peers (browser, ui, DOM) stay out, which the
# reporter output does not depend on. The scratch dirs are left behind for inspection; only the XML
# files below are written here.
#
# `vitest run` exits non-zero: the tests contain deliberate failures, and background.test.ts throws
# after its test ends (v5 reports that as an unhandled error; v3 and v4 drop it).
set -eu
dir=$(cd "$(dirname "$0")" && pwd)
root=$(mktemp -d "${TMPDIR:-/tmp}/probara-vitest-XXXXXX")
echo "generating in $root"

for version in 3.2.7 4.1.11 5.0.3; do
  work="$root/$version"
  mkdir -p "$work"
  cp -R "$dir/source/." "$work/"
  cd "$work"
  if [ "${version%%.*}" = 5 ]; then
    # vitest 5 declares vite as a required peer only, which --legacy-peer-deps leaves out: it goes in
    # beside vitest, at the latest version of its range (npm's own choice for a missing peer).
    npm install --no-audit --no-fund --legacy-peer-deps "vitest@$version" vite@8
  else
    npm install --no-audit --no-fund --legacy-peer-deps "vitest@$version"
  fi
  # The default junit reporter, then the same run with addFileAttribute (its own config file).
  npx vitest run --allowOnly --reporter=junit --outputFile=junit.xml || true
  npx vitest run --allowOnly --config vitest.file-attribute.config.mjs || true
  cp junit.xml "$dir/junit-$version.xml"
  cp junit-file-attribute.xml "$dir/junit-$version-add-file-attribute.xml"
  cd "$dir"
done

# Scripted sanitization of machine-specific strings (see ../README.md). Every scratch dir of this
# run sits under $root, which becomes /work/vitest.
node "$dir/../sanitize.mjs" vitest "$root"
