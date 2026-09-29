#!/usr/bin/env bash
# Regenerates the gotestsum fixtures in this directory.
# Tool versions used: go 1.27.1 darwin/arm64, gotestsum v1.13.0
#   (go install gotest.tools/gotestsum@v1.13.0).
# The panic stack trace embeds absolute GOROOT and source paths of the generating machine.
# gotestsum exits 1 because of deliberate failures; that is expected.
set -u
cd "$(dirname "$0")/source"

# 1. Default junit options (suite name and classname = full import path).
gotestsum --junitfile ../junit.xml -- -count=1 ./... || true

# 2. Short suite/classname (last path element) plus a <testsuites name>.
gotestsum --junitfile ../junit-short-names.xml \
  --junitfile-testsuite-name=short --junitfile-testcase-classname=short \
  --junitfile-project-name=probarafixture -- -count=1 ./... || true

# Other junit flags (not used): --junitfile-testsuite-name/--junitfile-testcase-classname
# accept full|relative|short; --junitfile-hide-empty-pkg; --junitfile-hide-skipped-tests.

# Scripted sanitization of machine-specific strings (see ../README.md). The generation
# working dir (this source/ folder) becomes /work/gotestsum.
node ../../sanitize.mjs gotestsum "$PWD"
