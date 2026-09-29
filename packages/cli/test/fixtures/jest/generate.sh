#!/usr/bin/env bash
# Regenerates the jest-junit fixtures in this directory.
# Tool versions used: node v22.14.0, jest 30.5.2, jest-junit 17.0.0 (see source/package.json).
# The XML embeds absolute stack-trace paths of the machine that generated it; they are not stable.
# jest exits non-zero because the scenario contains deliberate failures; that is expected.
set -u
cd "$(dirname "$0")/source"
npm install --no-audit --no-fund

# 1. Default jest-junit options (no file attribute, no console output).
JEST_JUNIT_OUTPUT_DIR=.. JEST_JUNIT_OUTPUT_NAME=junit.xml \
  npx jest --runInBand || true

# 2. addFileAttribute=true -> testcase gets file="<path relative to rootDir>".
JEST_JUNIT_OUTPUT_DIR=.. JEST_JUNIT_OUTPUT_NAME=junit-add-file-attribute.xml \
  JEST_JUNIT_ADD_FILE_ATTRIBUTE=true \
  npx jest --runInBand || true

# 3. includeConsoleOutput=true (+ file attribute) -> suite-level <system-out> with the
#    console buffer serialized as JSON. process.stdout/stderr.write is NOT captured.
JEST_JUNIT_OUTPUT_DIR=.. JEST_JUNIT_OUTPUT_NAME=junit-include-console-output.xml \
  JEST_JUNIT_INCLUDE_CONSOLE_OUTPUT=true JEST_JUNIT_ADD_FILE_ATTRIBUTE=true \
  npx jest --runInBand || true

rm -rf node_modules package-lock.json

# Other relevant jest-junit env options (not used here, defaults shown):
#   JEST_JUNIT_SUITE_NAME="{title}"            (top-level describe; "undefined" when the file has none)
#   JEST_JUNIT_CLASSNAME="{classname} {title}"  JEST_JUNIT_TITLE="{classname} {title}"
#   JEST_JUNIT_ANCESTOR_SEPARATOR=" "           JEST_JUNIT_UNIQUE_OUTPUT_NAME=false
#   JEST_JUNIT_ADD_FILE_ATTRIBUTE=false         JEST_JUNIT_INCLUDE_CONSOLE_OUTPUT=false
#   JEST_JUNIT_INCLUDE_SHORT_CONSOLE_OUTPUT=false  JEST_JUNIT_REPORT_TEST_SUITE_ERRORS=false
#   JEST_JUNIT_NO_STACK_TRACE=false             JEST_JUNIT_TEST_CASE_PROPERTIES_JSON_FILE / _DIR

# Scripted sanitization of machine-specific strings (see ../README.md). The generation
# working dir (this source/ folder) becomes /work/jest.
node ../../sanitize.mjs jest "$PWD"
