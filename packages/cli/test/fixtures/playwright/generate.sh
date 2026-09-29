#!/usr/bin/env bash
# Regenerates the Playwright junit-reporter fixtures in this directory.
# Tool versions used: node v22.14.0, @playwright/test 1.63.0. No browser is needed:
# the tests never use the `page` fixture (no `npx playwright install` required).
# Outputs: ../junit*.xml and ../test-results/ (attachments referenced from system-out).
# Absolute paths inside failure stack traces and error-context.md are machine-specific.
set -u
cd "$(dirname "$0")/source"
npm install --no-audit --no-fund

# 1. Default junit reporter options.
npx playwright test || true

# 2. includeRetries + includeProjectInTestName -> flakyFailure / rerunFailure / rerunError
#    children and a "[node] " prefix on every testcase name.
PW_JUNIT_OUTPUT_NAME=junit-include-retries.xml \
  PLAYWRIGHT_JUNIT_INCLUDE_RETRIES=1 PLAYWRIGHT_JUNIT_INCLUDE_PROJECT_IN_TEST_NAME=1 \
  npx playwright test || true

# Both runs write identical attachment paths (content-hashed names), so the second run's
# test-results/ serves both XML files. Drop Playwright's last-run bookkeeping file.
rm -f ../test-results/.last-run.json
rm -rf node_modules package-lock.json

# Scripted sanitization of machine-specific strings (see ../README.md). The generation
# working dir (this source/ folder) becomes /work/playwright.
node ../../sanitize.mjs playwright "$PWD"
