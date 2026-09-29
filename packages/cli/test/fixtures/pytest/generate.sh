#!/usr/bin/env bash
# Regenerates the pytest fixtures in this directory.
# Tool versions used: CPython 3.9.6, pytest 8.4.2 (pip install pytest==8.4.2).
# The XML embeds the generating machine's hostname, local-offset timestamp and an absolute
# path in <skipped> bodies; those are not stable. pytest exits 1 because of deliberate failures.
set -u
cd "$(dirname "$0")/source"

# 1. Defaults: junit_family=xunit2, junit_logging=no (no captured output in the XML).
pytest -p no:cacheprovider --junitxml=../junit.xml || true

# 2. junit_logging=all -> per-testcase <system-out>/<system-err> with pytest's section banners.
pytest -p no:cacheprovider --junitxml=../junit-logging-all.xml -o junit_logging=all || true

# 3. junit_family=xunit1 -> adds file= and (0-based) line= attributes on every testcase.
pytest -p no:cacheprovider --junitxml=../junit-xunit1.xml -o junit_family=xunit1 || true

find . -name __pycache__ -type d -prune -exec rm -rf {} +

# Scripted sanitization of machine-specific strings (see ../README.md). The generation
# working dir (this source/ folder) becomes /work/pytest.
node ../../sanitize.mjs pytest "$PWD"
