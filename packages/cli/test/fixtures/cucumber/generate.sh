#!/usr/bin/env bash
# Regenerates the Cucumber JSON fixture in this directory.
# Tool version used: @cucumber/cucumber 13.3.0 (see source/package.json), node v22.14.0.
# cucumber-js exits non-zero because the scenarios contain deliberate failures, an undefined step
# and an ambiguous one; that is expected.
# The JSON embeds the absolute stack paths of the machine that generated it; the sanitizer rewrites them.
set -u
cd "$(dirname "$0")/source"
npm install --no-audit --no-fund

npx cucumber-js \
  --require 'features/step_definitions/*.js' \
  --format json:../cucumber.json \
  features || true

rm -rf node_modules package-lock.json

# Scripted sanitization of machine-specific strings (see ../README.md). The generation
# working dir (this source/ folder) becomes /work/cucumber.
node ../../sanitize.mjs cucumber "$PWD"
